/* global Fuse */
importScripts('/static/speeches/js/fuse.min.js');

// Normalized doc shape inside the worker:
// { f: filename, t: title, c: content, u: url, d: date, s: speaker }

var SEARCH_OPTIONS = {
	includeMatches: true,
	ignoreLocation: true,
	minMatchCharLength: 2,
	threshold: 0.35,
	keys: [
		{ name: 't', weight: 0.55 },
		{ name: 's', weight: 0.15 },
		{ name: 'c', weight: 0.3 }
	]
};

var statePromise = null;
var remoteResultCache = new Map();

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDate(title) {
	var match = /^(\d{4}-\d{2}-\d{2})/.exec(title || '');
	return match ? match[1] : '';
}

function deriveFilenameFromUrl(url) {
	try {
		var parsed = new URL(url, 'https://archive.tw');
		var segments = parsed.pathname.split('/').filter(Boolean);
		return segments[0] ? decodeURIComponent(segments[0]) : '';
	} catch (_error) {
		return '';
	}
}

function normalizeLegacyDocs(payload) {
	if (!Array.isArray(payload)) return [];
	return payload.map(function (doc) {
		return {
			f: deriveFilenameFromUrl(doc.u || ''),
			t: doc.t || '',
			c: doc.c || '',
			u: doc.u || '',
			d: doc.d || extractDate(doc.t || ''),
			s: doc.s || ''
		};
	});
}

function inflatePackedDocs(payload) {
	if (!payload || payload.v !== 2 || !Array.isArray(payload.pages) || !Array.isArray(payload.docs)) {
		return normalizeLegacyDocs(payload);
	}

	var speakers = Array.isArray(payload.speakers) ? payload.speakers : [];
	var docs = [];

	for (var i = 0; i < payload.docs.length; i++) {
		var doc = payload.docs[i];
		var page = payload.pages[doc[0]];
		if (!page) continue;

		var filename = page[0] || '';
		var pageUrl = page[1] || '';
		var title = page[2] || '';
		var sectionId = doc[1];
		var speakerIndex = doc[2];
		var content = doc[3] || '';
		var url = sectionId == null ? pageUrl : pageUrl + '#s' + sectionId;

		docs.push({
			f: filename,
			t: title,
			c: content,
			u: url,
			d: extractDate(title),
			s: speakerIndex >= 0 ? speakers[speakerIndex] || '' : ''
		});
	}

	return docs;
}

function fetchJson(url) {
	return fetch(url, { headers: { Accept: 'application/json' } }).then(function (response) {
		if (!response.ok) throw new Error('JSON fetch failed: ' + response.status + ' for ' + url);
		return response.json();
	});
}

function fetchRemoteResults(query, limit) {
	if (!query || limit <= 0) return Promise.resolve([]);

	var cacheKey = query + '\0' + limit;
	if (remoteResultCache.has(cacheKey)) {
		return Promise.resolve(remoteResultCache.get(cacheKey));
	}

	var params = new URLSearchParams();
	params.set('q', query);
	params.set('limit', String(limit));

	return fetchJson('/api/search.json?' + params.toString())
		.then(function (payload) {
			var results = Array.isArray(payload && payload.results)
				? payload.results
				: (Array.isArray(payload) ? payload : []);
			remoteResultCache.set(cacheKey, results);
			return results;
		})
		.catch(function () {
			return [];
		});
}

function loadManifest() {
	return fetchJson('/search-index-manifest.json').catch(function () {
		return { baselineVersion: '', overlays: {} };
	});
}

function loadOverlayDocs(manifest) {
	var overlays = manifest && manifest.overlays ? manifest.overlays : {};
	var filenames = Object.keys(overlays);
	if (filenames.length === 0) {
		return Promise.resolve({
			deleted: {},
			successful: {},
			docs: []
		});
	}

	var deleted = {};
	var overlayRequests = [];
	for (var i = 0; i < filenames.length; i++) {
		var filename = filenames[i];
		var overlay = overlays[filename] || {};
		if (overlay.deleted) {
			deleted[filename] = true;
			continue;
		}

		var version = overlay.updatedAt ? '?v=' + encodeURIComponent(overlay.updatedAt) : '';
		(function (overlayFilename, overlayUrl) {
			overlayRequests.push(
				fetchJson(overlayUrl)
					.then(function (payload) {
						return { filename: overlayFilename, docs: inflatePackedDocs(payload) };
					})
					.catch(function () {
						return null;
					})
			);
		})(filename, '/search-updates/' + encodeURIComponent(filename) + '.json' + version);
	}

	return Promise.all(overlayRequests).then(function (results) {
		var successful = {};
		var docs = [];
		for (var i = 0; i < results.length; i++) {
			var result = results[i];
			if (!result) continue;
			successful[result.filename] = true;
			for (var j = 0; j < result.docs.length; j++) {
				docs.push(result.docs[j]);
			}
		}
		return { deleted: deleted, successful: successful, docs: docs };
	});
}

function isLatinAlphabetQuery(query) {
	var parts = query.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return false;
	return parts.every(function (part) { return /^\p{Script=Latin}+$/u.test(part); });
}

function buildLatinWholeWordRegex(query) {
	var phrasePattern = query
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(function (part) { return escapeRegExp(part); })
		.join('\\s+');
	return new RegExp('(^|[^\\p{Script=Latin}])' + phrasePattern + '($|[^\\p{Script=Latin}])', 'iu');
}

function prioritizeLatinWholeWordMatches(query, results) {
	if (!isLatinAlphabetQuery(query) || results.length <= 1) return results;

	var wholeWordMatcher = buildLatinWholeWordRegex(query);
	return results
		.map(function (result, index) {
			return {
				result: result,
				index: index,
				hasWholeWordMatch:
					wholeWordMatcher.test(result.item.t) || wholeWordMatcher.test(result.item.c)
			};
		})
		.sort(function (a, b) {
			if (a.hasWholeWordMatch === b.hasWholeWordMatch) return a.index - b.index;
			return a.hasWholeWordMatch ? -1 : 1;
		})
		.map(function (entry) { return entry.result; });
}

function collectLatinWholeWordDocs(query, docs, limit) {
	if (!isLatinAlphabetQuery(query) || docs.length === 0 || limit <= 0) return [];

	var wholeWordMatcher = buildLatinWholeWordRegex(query);
	var matches = [];
	for (var i = 0; i < docs.length; i++) {
		var doc = docs[i];
		if (wholeWordMatcher.test(doc.t) || wholeWordMatcher.test(doc.c)) {
			matches.push(doc);
			if (matches.length >= limit) break;
		}
	}
	return matches;
}

function trimSnippet(content, start, end) {
	if (start === undefined) start = 0;
	if (end === undefined) end = 90;
	var safeStart = Math.max(0, start);
	var safeEnd = Math.min(content.length, end);
	var snippet = content.slice(safeStart, safeEnd).trim();
	if (safeStart > 0 && snippet) snippet = '\u2026' + snippet;
	if (safeEnd < content.length && snippet) snippet = snippet + '\u2026';
	return snippet;
}

function buildSnippet(result) {
	var content = result.item.c.trim();
	if (!content) return '';

	var contentMatch = null;
	if (result.matches) {
		for (var i = 0; i < result.matches.length; i++) {
			if (result.matches[i].key === 'c' && result.matches[i].indices.length > 0) {
				contentMatch = result.matches[i];
				break;
			}
		}
	}
	if (!contentMatch) return trimSnippet(content);

	var matchStart = contentMatch.indices[0][0];
	var matchEnd = contentMatch.indices[0][1];
	return trimSnippet(content, matchStart - 18, matchEnd + 42);
}

function loadState() {
	if (statePromise) return statePromise;

	statePromise = loadManifest()
		.then(function (manifest) {
			var version = manifest && manifest.baselineVersion
				? '?v=' + encodeURIComponent(manifest.baselineVersion)
				: '';
			return Promise.all([
				fetchJson('/search-index.json' + version),
				loadOverlayDocs(manifest)
			]);
		})
		.then(function (parts) {
			var baselinePayload = parts[0];
			var overlays = parts[1];
			var baselineDocs = inflatePackedDocs(baselinePayload);
			var mergedDocs = [];

			for (var i = 0; i < baselineDocs.length; i++) {
				var doc = baselineDocs[i];
				if (overlays.deleted[doc.f]) continue;
				if (overlays.successful[doc.f]) continue;
				mergedDocs.push(doc);
			}
			for (var j = 0; j < overlays.docs.length; j++) {
				mergedDocs.push(overlays.docs[j]);
			}

			return {
				docs: mergedDocs,
				fuse: new Fuse(mergedDocs, SEARCH_OPTIONS)
			};
		})
		.catch(function (error) {
			statePromise = null;
			throw error;
		});

	return statePromise;
}

function runLocalSearch(state, query, limit) {
	var latinQuery = isLatinAlphabetQuery(query);
	var candidateLimit = latinQuery
		? Math.min(180, Math.max(limit * 3, 60))
		: Math.min(220, Math.max(limit * 4, 80));

	var fuseResults = state.fuse.search(query, { limit: candidateLimit });
	var prioritized = prioritizeLatinWholeWordMatches(query, fuseResults);

	var ranked;
	if (!latinQuery) {
		ranked = prioritized.slice(0, limit).map(function (r) {
			return { doc: r.item, fuseResult: r };
		});
	} else {
		var wholeWordMatcher = buildLatinWholeWordRegex(query);
		var wholeWordFromAll = collectLatinWholeWordDocs(
			query,
			state.docs,
			Math.min(320, Math.max(limit * 4, 120))
		);
		var merged = new Map();
		var addDoc = function (entry) {
			merged.set(entry.doc.t + '\0' + entry.doc.u, entry);
		};

		for (var i = 0; i < prioritized.length; i++) {
			var doc = prioritized[i].item;
			if (
				wholeWordMatcher.test(doc.t)
				|| wholeWordMatcher.test(doc.c)
				|| wholeWordMatcher.test(doc.s || '')
			) {
				addDoc({ doc: doc, fuseResult: prioritized[i] });
			}
		}
		for (var j = 0; j < wholeWordFromAll.length; j++) {
			addDoc({ doc: wholeWordFromAll[j] });
		}
		for (var k = 0; k < prioritized.length; k++) {
			addDoc({ doc: prioritized[k].item, fuseResult: prioritized[k] });
		}

		ranked = Array.from(merged.values()).slice(0, limit);
	}

	var seen = new Map();
	for (var ri = 0; ri < ranked.length; ri++) {
		var entry = ranked[ri];
		var baseUrl = entry.doc.u.split('#')[0];
		if (seen.has(baseUrl)) continue;
		seen.set(baseUrl, entry);
	}

	return Array.from(seen.values()).map(function (entry) {
		return {
			title: entry.doc.t,
			url: entry.doc.u,
			date: entry.doc.d || '',
			speaker: entry.doc.s || '',
			snippet: entry.fuseResult ? buildSnippet(entry.fuseResult) : trimSnippet(entry.doc.c)
		};
	});
}

function mergeResults(primary, secondary, limit) {
	var merged = [];
	var seen = new Set();

	function addAll(items) {
		for (var i = 0; i < items.length; i++) {
			var item = items[i];
			var baseUrl = (item.url || '').split('#')[0];
			if (seen.has(baseUrl)) continue;
			seen.add(baseUrl);
			merged.push(item);
			if (merged.length >= limit) return;
		}
	}

	addAll(primary);
	if (merged.length < limit) addAll(secondary);
	return merged.slice(0, limit);
}

self.addEventListener('message', function (event) {
	var message = event.data;
	var query = (message.query || '').trim();
	var limit = message.limit || 50;

	loadState().then(function (state) {
		if (message.type === 'warmup') {
			self.postMessage({ type: 'ready' });
			return;
		}

		return Promise.all([
			Promise.resolve(runLocalSearch(state, query, limit)),
			query.length >= 2 ? fetchRemoteResults(query, limit) : Promise.resolve([])
		]).then(function (parts) {
			var localResults = parts[0];
			var remoteResults = parts[1];
			var results = mergeResults(remoteResults, localResults, limit);
			self.postMessage({
				type: 'results',
				requestId: message.requestId,
				results: results,
				total: results.length
			});
		});
	}).catch(function (error) {
		if (message.type === 'warmup') {
			self.postMessage({ type: 'ready' });
			return;
		}

		fetchRemoteResults(query, limit).then(function (remoteResults) {
			self.postMessage({
				type: 'results',
				requestId: message.requestId,
				results: remoteResults,
				total: remoteResults.length
			});
		}).catch(function () {
			self.postMessage({
				type: 'error',
				requestId: message.requestId,
				message: error instanceof Error ? error.message : 'Search index load failed'
			});
		});
	});
});
