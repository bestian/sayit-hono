/* global Fuse */
importScripts('/static/speeches/js/fuse.min.js');

// Doc shape: { t: title, c: content, u: url, d?: date, s?: speaker }

var SEARCH_OPTIONS = {
	includeMatches: true,
	ignoreLocation: true,
	minMatchCharLength: 2,
	threshold: 0.35,
	keys: [
		{ name: 't', weight: 0.7 },
		{ name: 'c', weight: 0.3 }
	]
};

var statePromise = null;

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

	statePromise = fetch('/search-index.json', { headers: { Accept: 'application/json' } })
		.then(function (response) {
			if (!response.ok) throw new Error('Search index fetch failed: ' + response.status);
			return response.json();
		})
		.then(function (docs) {
			return {
				docs: docs,
				fuse: new Fuse(docs, SEARCH_OPTIONS)
			};
		})
		.catch(function (error) {
			statePromise = null;
			throw error;
		});

	return statePromise;
}

self.addEventListener('message', function (event) {
	var message = event.data;

	loadState().then(function (state) {
		if (message.type === 'warmup') {
			self.postMessage({ type: 'ready' });
			return;
		}

		var query = message.query.trim();
		var limit = message.limit || 50;
		var latinQuery = isLatinAlphabetQuery(query);
		var candidateLimit = latinQuery
			? Math.min(500, Math.max(limit * 10, 100))
			: Math.max(limit * 5, 100);

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
				query, state.docs,
				Math.min(1200, Math.max(limit * 8, 300))
			);
			var merged = new Map();
			var addDoc = function (entry) {
				merged.set(entry.doc.t + '\0' + entry.doc.u, entry);
			};

			for (var i = 0; i < prioritized.length; i++) {
				var doc = prioritized[i].item;
				if (wholeWordMatcher.test(doc.t) || wholeWordMatcher.test(doc.c)) {
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

		// Deduplicate: keep best section per speech (by base URL without #anchor)
		var seen = new Map();
		for (var ri = 0; ri < ranked.length; ri++) {
			var entry = ranked[ri];
			var baseUrl = entry.doc.u.split('#')[0];
			if (seen.has(baseUrl)) {
				// Prefer a result that matched on content over title-only
				var existing = seen.get(baseUrl);
				var existingHasContentMatch = existing.fuseResult && existing.fuseResult.matches &&
					existing.fuseResult.matches.some(function (m) { return m.key === 'c'; });
				var newHasContentMatch = entry.fuseResult && entry.fuseResult.matches &&
					entry.fuseResult.matches.some(function (m) { return m.key === 'c'; });
				if (newHasContentMatch && !existingHasContentMatch) {
					seen.set(baseUrl, entry);
				}
				continue;
			}
			seen.set(baseUrl, entry);
		}
		var deduped = Array.from(seen.values());

		var results = deduped.map(function (entry) {
			return {
				title: entry.doc.t,
				url: entry.doc.u,
				date: entry.doc.d || '',
				speaker: entry.doc.s || '',
				snippet: entry.fuseResult ? buildSnippet(entry.fuseResult) : trimSnippet(entry.doc.c)
			};
		});

		self.postMessage({
			type: 'results',
			requestId: message.requestId,
			results: results,
			total: results.length
		});
	}).catch(function (error) {
		self.postMessage({
			type: 'error',
			requestId: message.requestId,
			message: error instanceof Error ? error.message : 'Search index load failed'
		});
	});
});
