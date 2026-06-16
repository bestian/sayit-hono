(function () {
	'use strict';

	var input = document.getElementById('sayit-search-input');
	var results = document.getElementById('sayit-search-results');
	var shortcutBadge = document.getElementById('sayit-search-shortcut');
	var speechList = document.getElementById('sayit-speech-list');
	var askPanel = document.getElementById('sayit-ask');
	var askSubmit = document.getElementById('sayit-ask-submit');
	var askConsent = document.getElementById('sayit-ask-consent');
	var askStatus = document.getElementById('sayit-ask-status');
	var askAnswer = document.getElementById('sayit-ask-answer');
	if (!input || !results) return;

	var isZh = document.documentElement.classList.contains('lang-zh');
	var ASK_STRINGS = {
		zh: {
			searchPlaceholder: '搜尋對話內容…',
			searchAriaLabel: '搜尋對話',
			submit: '💬 提問',
			submitting: '💬 提問中…',
			cooldown: function (seconds) { return '💬 ' + seconds + ' 秒後可再提問'; },
			searching: '檢索逐字稿中…',
			sourcesHeading: '出處',
			questionTooLong: '問題太長，請縮短到 100 字以內。',
			fetchError: '提問服務暫時無法使用，請稍後再試。',
			networkError: '連線發生錯誤，請稍後再試。',
		},
		en: {
			searchPlaceholder: 'Search speeches…',
			searchAriaLabel: 'Search speeches',
			submit: '💬 Ask',
			submitting: '💬 Asking…',
			cooldown: function (seconds) { return '💬 Ask again in ' + seconds + ' s'; },
			searching: 'Searching the transcripts…',
			sourcesHeading: 'Sources',
			questionTooLong: 'Your question is too long. Please shorten it to 100 characters or fewer.',
			fetchError: 'The ask service is temporarily unavailable. Please try again later.',
			networkError: 'Connection error. Please try again later.',
		},
	};
	var askT = ASK_STRINGS[isZh ? 'zh' : 'en'];
	input.setAttribute('placeholder', askT.searchPlaceholder);
	input.setAttribute('aria-label', askT.searchAriaLabel);

	var worker = null;
	var debounceTimer = null;
	var currentQuery = '';
	var PAGE_SIZE = 12;
	var currentSearchResults = null;
	var displayedCount = 0;
	var requestId = 0;
	var pendingResolves = {};
	var workerWarmed = false;
	var askAvailable = false;
	var askLoading = false;
	var askCooldownTimer = null;
	var askCooldownRemaining = 0;
	var askAbortController = null;
	var ASK_BASE_URL = 'https://ask.archive.tw';

	function shouldWarmupOnFocus() {
		var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		if (!connection) return true;
		if (connection.saveData) return false;
		return !/^(slow-2g|2g|3g)$/i.test(connection.effectiveType || '');
	}

	function ensureWorker(shouldWarmup) {
		if (worker) return;
		worker = new Worker('/static/speeches/js/fuse-search.worker.js');
		worker.addEventListener('error', function (event) {
			console.error('Search worker crashed', event.message || event);
		});
		worker.addEventListener('message', function (e) {
			var msg = e.data;
			if (msg.requestId != null && pendingResolves[msg.requestId]) {
				pendingResolves[msg.requestId](msg);
				delete pendingResolves[msg.requestId];
			}
		});
		if (shouldWarmup !== false) {
			workerWarmed = true;
			worker.postMessage({ type: 'warmup' });
		}
	}

	function searchViaWorker(query, limit) {
		if (!worker) ensureWorker(true);
		if (!workerWarmed) {
			workerWarmed = true;
			worker.postMessage({ type: 'warmup' });
		}
		var id = ++requestId;
		return new Promise(function (resolve) {
			pendingResolves[id] = resolve;
			worker.postMessage({ type: 'search', query: query, limit: limit, requestId: id });
		});
	}

	function escapeHtml(str) {
		var div = document.createElement('div');
		div.textContent = str;
		return div.innerHTML;
	}

	function decodeHtmlEntities(str) {
		if (!str || typeof str !== 'string' || str.indexOf('&') === -1) return str || '';
		var textarea = document.createElement('textarea');
		textarea.innerHTML = str;
		return textarea.value;
	}

	function isSafeHttpUrl(value) {
		if (/[\s"'<>]/.test(value) || /&(quot|#39|lt|gt);/i.test(value)) return false;
		try {
			var url = new URL(value);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch (e) {
			return false;
		}
	}

	function sanitizeHtml(html) {
		var doc = new DOMParser().parseFromString(html, 'text/html');
		var blocked = doc.body.querySelectorAll('script, iframe, object, embed, base, meta, link');
		for (var i = 0; i < blocked.length; i++) blocked[i].remove();

		var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
		var element = walker.nextNode();
		while (element) {
			var attrs = Array.prototype.slice.call(element.attributes);
			for (var j = 0; j < attrs.length; j++) {
				var attr = attrs[j];
				var name = attr.name.toLowerCase();
				if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'style') {
					element.removeAttribute(attr.name);
					continue;
				}
				if (/^(href|src|xlink:href|action|formaction|poster)$/i.test(name) && !isSafeHttpUrl(attr.value)) {
					element.removeAttribute(attr.name);
				}
			}
			if (element.tagName.toLowerCase() === 'a') {
				element.setAttribute('target', '_blank');
				element.setAttribute('rel', 'nofollow noopener noreferrer');
			}
			element = walker.nextNode();
		}

		return doc.body.innerHTML;
	}

	function parseAskAnswer(raw) {
		var sources = [];
		var seen = {};
		var body = (raw || '').replace(/^\[\^(\d+)\]:\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/gm, function (_m, num, label, href) {
			if (!isSafeHttpUrl(href)) return '';
			var index = Number(num);
			if (!seen[index]) {
				seen[index] = true;
				sources.push({ index: index, label: label.trim() || href, href: href });
			}
			return '';
		}).trim();
		sources.sort(function (a, b) { return a.index - b.index; });

		var hrefByIndex = {};
		for (var i = 0; i < sources.length; i++) hrefByIndex[sources[i].index] = sources[i].href;

		var html = escapeHtml(body);
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, function (_m, label, href) {
			if (!isSafeHttpUrl(href)) return escapeHtml(label);
			return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
		});
		html = html.replace(/\[\^(\d+)\]/g, function (m, num) {
			var href = hrefByIndex[Number(num)];
			if (!href) return '';
			return '<sup class="cite"><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">[' + escapeHtml(num) + ']</a></sup>';
		});

		return { html: sanitizeHtml(html), sources: sources };
	}

	function showResults() {
		results.hidden = false;
		if (speechList) speechList.style.display = 'none';
	}

	function hideResults() {
		results.hidden = true;
		results.innerHTML = '';
		if (speechList) speechList.style.display = '';
		currentSearchResults = null;
		displayedCount = 0;
	}

	function hideAskAnswer() {
		if (!askAnswer) return;
		askAnswer.hidden = true;
		askAnswer.innerHTML = '';
	}

	function setAskStatus(message) {
		if (askStatus) askStatus.textContent = message || '';
	}

	function consentAccepted() {
		return askConsent ? askConsent.checked : false;
	}

	function updateAskControls() {
		if (!askSubmit) return;
		var hasQuestion = Boolean(input.value.trim());
		var disabled = askLoading || askCooldownRemaining > 0;
		var canAsk = consentAccepted();
		askSubmit.disabled = disabled || !hasQuestion || !canAsk;
		askSubmit.textContent = askLoading
			? askT.submitting
			: (askCooldownRemaining > 0 ? askT.cooldown(askCooldownRemaining) : askT.submit);
		if (askConsent) askConsent.disabled = askLoading;

		if (!askPanel) return;
		var samples = askPanel.querySelectorAll('[data-sayit-ask-question]');
		for (var i = 0; i < samples.length; i++) {
			samples[i].disabled = disabled || !canAsk;
		}
	}

	function startAskCooldown(seconds) {
		askCooldownRemaining = Math.max(0, Number(seconds) || 0);
		if (askCooldownTimer) clearInterval(askCooldownTimer);
		if (askCooldownRemaining <= 0) {
			updateAskControls();
			return;
		}
		updateAskControls();
		askCooldownTimer = setInterval(function () {
			askCooldownRemaining -= 1;
			if (askCooldownRemaining <= 0) {
				askCooldownRemaining = 0;
				clearInterval(askCooldownTimer);
				askCooldownTimer = null;
			}
			updateAskControls();
		}, 1000);
	}

	function renderAskAnswer(raw, loading, error) {
		if (!askAnswer) return;
		askAnswer.hidden = false;
		if (error) {
			askAnswer.innerHTML = '<p class="homepage-ask-answer__error">' + sanitizeHtml(escapeHtml(error)) + '</p>';
			return;
		}

		var parsed = parseAskAnswer(raw);
		var html = '';
		if (!parsed.html && loading) {
			html += '<p class="homepage-ask-answer__status">' + escapeHtml(askT.searching) + '</p>';
		}
		if (parsed.html) {
			html += '<div class="homepage-ask-answer__body">' + parsed.html + '</div>';
		}
		if (loading) {
			html += '<span class="homepage-ask-answer__cursor" aria-hidden="true">▌</span>';
		}
		if (parsed.sources.length > 0) {
			html += '<div class="homepage-ask-answer__sources"><h3>' + escapeHtml(askT.sourcesHeading) + '</h3><ol>';
			for (var i = 0; i < parsed.sources.length; i++) {
				var source = parsed.sources[i];
				html += '<li value="' + source.index + '"><a href="' + escapeHtml(source.href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.label) + '</a></li>';
			}
			html += '</ol></div>';
		}
		askAnswer.innerHTML = html;
	}

	function renderLoading() {
		showResults();
		results.innerHTML =
			'<div class="sayit-search__loading">' +
			'<div class="sayit-search__spinner"></div>' +
			'<span>' + (isZh ? '搜尋中…' : 'Searching…') + '</span>' +
			'</div>';
	}

	function renderNoResults(query) {
		showResults();
		results.innerHTML =
			'<div class="sayit-search__results-inner">' +
			'<div class="sayit-search__status">' +
			(isZh
				? '找不到與「' + escapeHtml(query) + '」相關的結果'
				: 'No results for \u201c' + escapeHtml(query) + '\u201d') +
			'</div>' +
			'</div>';
	}

	function renderError() {
		showResults();
		results.innerHTML =
			'<div class="sayit-search__status">' +
			(isZh ? '搜尋功能暫時無法使用' : 'Search is currently unavailable') +
			'</div>';
	}

	function groupResults(items) {
		var groups = [];
		var groupMap = {};
		for (var i = 0; i < items.length; i++) {
			var item = items[i];
			var baseUrl = (item.url || '').split('#')[0];
			if (groupMap[baseUrl] != null) {
				groups[groupMap[baseUrl]].sections.push(item);
			} else {
				groupMap[baseUrl] = groups.length;
				groups.push({
					title: item.title,
					date: item.date,
					url: baseUrl,
					sections: [item]
				});
			}
		}
		return groups;
	}

	function renderGroupItem(group) {
		var title = decodeHtmlEntities(group.title || group.url);
		var date = group.date || '';
		var displayTitle = date ? title.replace(new RegExp('^' + date + '\\s*'), '') : title;

		// Collect unique speakers across sections
		var speakersSeen = {};
		var speakers = [];
		for (var i = 0; i < group.sections.length; i++) {
			var s = group.sections[i].speaker || '';
			if (s && !speakersSeen[s]) {
				speakersSeen[s] = true;
				speakers.push(s);
			}
		}

		var metaParts = [];
		if (date) metaParts.push('<span>' + escapeHtml(date) + '</span>');
		if (speakers.length > 0) metaParts.push('<span>' + escapeHtml(decodeHtmlEntities(speakers.join(', '))) + '</span>');

		var html =
			'<div class="sayit-search__result-group">' +
			'<a href="' + escapeHtml(group.sections[0].url) + '" class="sayit-search__result-title">' + escapeHtml(displayTitle) + '</a>' +
			(metaParts.length > 0
				? '<div class="sayit-search__result-meta">' + metaParts.join('<span aria-hidden="true"> \u00b7 </span>') + '</div>'
				: '');

		for (var j = 0; j < group.sections.length; j++) {
			var section = group.sections[j];
			var snippet = decodeHtmlEntities(section.snippet || '');
			var speaker = decodeHtmlEntities(section.speaker || '');
			if (snippet) {
				html +=
					'<a href="' + escapeHtml(section.url) + '" class="sayit-search__result-section">' +
					(speakers.length > 1 && speaker ? '<span class="sayit-search__result-speaker">' + escapeHtml(speaker) + '</span>' : '') +
					'<span class="sayit-search__result-excerpt">' + escapeHtml(snippet) + '</span>' +
					'</a>';
			}
		}

		html += '</div>';
		return html;
	}

	function moreButtonText(remaining) {
		return isZh
			? '顯示更多結果（剩餘 ' + remaining + ' 筆）'
			: 'Show more (' + remaining + ' remaining)';
	}

	function loadMore() {
		if (!currentSearchResults || displayedCount >= currentSearchResults.length) return;
		var btn = document.getElementById('sayit-search-more');
		var nextSlice = currentSearchResults.slice(displayedCount, displayedCount + PAGE_SIZE);
		var container = document.getElementById('sayit-search-items');
		if (container) {
			for (var i = 0; i < nextSlice.length; i++) {
				container.insertAdjacentHTML('beforeend', renderGroupItem(nextSlice[i]));
			}
		}
		displayedCount += nextSlice.length;
		if (btn) {
			if (displayedCount >= currentSearchResults.length) {
				btn.remove();
			} else {
				btn.textContent = moreButtonText(currentSearchResults.length - displayedCount);
			}
		}
	}

	function renderResults(groups, query, totalCount) {
		if (groups.length === 0) {
			renderNoResults(query);
			return;
		}

		showResults();
		var countText = isZh
			? '找到 ' + totalCount + ' 項結果'
			: totalCount + ' result' + (totalCount !== 1 ? 's' : '') + ' found';
		var html =
			'<div class="sayit-search__results-inner">' +
			'<div class="sayit-search__status">' + escapeHtml(countText) + '</div>' +
			'<div id="sayit-search-items">';

		for (var i = 0; i < groups.length; i++) {
			html += renderGroupItem(groups[i]);
		}

		html += '</div>';

		if (totalCount > displayedCount) {
			html +=
				'<button type="button" id="sayit-search-more" class="sayit-search__more">' +
				moreButtonText(totalCount - displayedCount) +
				'</button>';
		}

		html += '</div>';
		results.innerHTML = html;

		var moreBtn = document.getElementById('sayit-search-more');
		if (moreBtn) moreBtn.addEventListener('click', loadMore);
	}

	function doSearch(query) {
		if (!query.trim()) {
			hideResults();
			return;
		}

		hideAskAnswer();
		currentQuery = query;
		currentSearchResults = null;
		displayedCount = 0;
		renderLoading();

		ensureWorker(true);

		searchViaWorker(query, 100).then(function (msg) {
			if (query !== currentQuery) return;

			if (msg.type === 'error') {
				console.error('Search worker failed', msg.message || 'unknown error');
				renderError();
				return;
			}

			if (!msg.results || msg.results.length === 0) {
				renderNoResults(query);
				return;
			}

			var groups = groupResults(msg.results);
			currentSearchResults = groups;
			var firstPage = groups.slice(0, PAGE_SIZE);
			displayedCount = firstPage.length;
			renderResults(firstPage, query, groups.length);
		});
	}

	function setAskLoading(value) {
		askLoading = value;
		updateAskControls();
	}

	function askEndpointForQuestion(question) {
		var endpoint = ASK_BASE_URL + '/cag/' + encodeURIComponent(question);
		return isZh ? endpoint : endpoint + '?lang=en';
	}

	function parseRetryAfter(response) {
		var retryAfter = Number(response.headers.get('Retry-After'));
		return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 0;
	}

	function runAsk(question) {
		var query = (question || '').trim();
		if (!askAvailable || !query || askLoading || askCooldownRemaining > 0 || !consentAccepted()) return;
		if (query.length > 100) {
			renderAskAnswer('', false, askT.questionTooLong);
			return;
		}

		input.value = query;
		currentQuery = '';
		clearTimeout(debounceTimer);
		hideResults();
		setAskStatus('');
		renderAskAnswer('', true, '');
		setAskLoading(true);

		if (askAbortController) askAbortController.abort();
		askAbortController = new AbortController();

		fetch(askEndpointForQuestion(query), { signal: askAbortController.signal }).then(function (response) {
			if (!response.ok) {
				return response.text().then(function (text) {
					var retryAfter = parseRetryAfter(response);
					if (response.status === 429 && retryAfter > 0) startAskCooldown(retryAfter);
					throw new Error(text || askT.fetchError);
				});
			}

			if (!response.body || !response.body.getReader) {
				return response.text().then(function (text) {
					renderAskAnswer(text, false, '');
				});
			}

			var reader = response.body.getReader();
			var decoder = new TextDecoder();
			var raw = '';

			function readNext() {
				return reader.read().then(function (chunk) {
					if (chunk.done) {
						raw += decoder.decode();
						renderAskAnswer(raw, false, '');
						return;
					}
					raw += decoder.decode(chunk.value, { stream: true });
					renderAskAnswer(raw, true, '');
					return readNext();
				});
			}

			return readNext();
		}).catch(function (error) {
			if (error && error.name === 'AbortError') return;
			renderAskAnswer('', false, error && error.message ? error.message : askT.networkError);
		}).finally(function () {
			setAskLoading(false);
			askAbortController = null;
		});
	}

	function initAsk() {
		if (!askSubmit || !askAnswer || !window.fetch) return;

		fetch(ASK_BASE_URL + '/capacity', { headers: { Accept: 'application/json' } }).then(function (response) {
			if (!response.ok) throw new Error('capacity unavailable');
			return response.json();
		}).then(function (data) {
			if (!data || data.status !== 'available') return;
			askAvailable = true;
			if (askPanel) askPanel.hidden = false;
			askSubmit.hidden = false;
			updateAskControls();
		}).catch(function () {
			askAvailable = false;
		});

		askSubmit.addEventListener('click', function () {
			runAsk(input.value);
		});

		if (askConsent) {
			askConsent.addEventListener('change', function () {
				updateAskControls();
			});
		}

		if (!askPanel) return;
		var samples = askPanel.querySelectorAll('[data-sayit-ask-question]');
		for (var i = 0; i < samples.length; i++) {
			samples[i].addEventListener('click', function (event) {
				var question = event.currentTarget.getAttribute('data-sayit-ask-question') || '';
				runAsk(question);
			});
		}
	}

	input.addEventListener('input', function () {
		clearTimeout(debounceTimer);
		var query = input.value;
		updateAskControls();
		if (!query.trim()) {
			hideResults();
			hideAskAnswer();
			currentQuery = '';
			return;
		}
		debounceTimer = setTimeout(function () {
			doSearch(query);
		}, 250);
	});

	input.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			input.value = '';
			input.blur();
			hideResults();
			hideAskAnswer();
			currentQuery = '';
			clearTimeout(debounceTimer);
			updateAskControls();
		}
	});

	document.addEventListener('keydown', function (e) {
		if (e.key !== '/') return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
		if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
		if (document.activeElement && document.activeElement.isContentEditable) return;
		e.preventDefault();
		input.focus();
		input.select();
	});

	input.addEventListener('focus', function () {
		if (shortcutBadge) shortcutBadge.style.opacity = '0';
		ensureWorker(false);
	});

	input.addEventListener('blur', function () {
		if (shortcutBadge && !input.value) shortcutBadge.style.opacity = '1';
	});

	initAsk();
})();
