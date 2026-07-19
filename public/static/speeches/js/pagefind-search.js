(function () {
	'use strict';

	var input = document.getElementById('sayit-search-input');
	var results = document.getElementById('sayit-search-results');
	var shortcutBadge = document.getElementById('sayit-search-shortcut');
	var speechList = document.getElementById('sayit-speech-list');
	var askPanel = document.getElementById('sayit-ask');
	var askSubmit = document.getElementById('sayit-ask-submit');
		var askStatus = document.getElementById('sayit-ask-status');
	var askAnswer = document.getElementById('sayit-ask-answer');
	var lastAskMarkdown = '';
	var askCopyResetTimer = null;
	if (!input) return;

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
			copyMarkdown: '複製 Markdown',
			copiedMarkdown: '已複製',
			copyFailed: '無法複製，請手動選取文字',
			questionTooLong: '問題太長，請縮短到 100 字以內。',
			fetchError: '提問服務暫時無法使用，請稍後再試。',
			networkError: '連線發生錯誤，請稍後再試。',
			consentRequired: '請先同意隱私權政策和使用條款，再按 Enter 提問；一般搜尋結果仍會顯示。',
		},
		en: {
			searchPlaceholder: 'Search speeches…',
			searchAriaLabel: 'Search speeches',
			submit: '💬 Ask',
			submitting: '💬 Asking…',
			cooldown: function (seconds) { return '💬 Ask again in ' + seconds + ' s'; },
			searching: 'Searching the transcripts…',
			sourcesHeading: 'Sources',
			copyMarkdown: 'Copy Markdown',
			copiedMarkdown: 'Copied',
			copyFailed: 'Could not copy. Select the answer and copy manually.',
			questionTooLong: 'Your question is too long. Please shorten it to 100 characters or fewer.',
			fetchError: 'The ask service is temporarily unavailable. Please try again later.',
			networkError: 'Connection error. Please try again later.',
			consentRequired: 'Please agree to the Privacy Policy and Terms of Use first to ask AI; regular search results will still show.',
		},
	};
	var askT = ASK_STRINGS[isZh ? 'zh' : 'en'];
	input.setAttribute('placeholder', askT.searchPlaceholder);
	input.setAttribute('aria-label', askT.searchAriaLabel);
	function refreshSearchI18n() {
		isZh = document.documentElement.classList.contains('lang-zh');
		askT = ASK_STRINGS[isZh ? 'zh' : 'en'];
		input.setAttribute('placeholder', askT.searchPlaceholder);
		input.setAttribute('aria-label', askT.searchAriaLabel);
		updateAskControls();
	}

	var searchSubmitButtons = document.querySelectorAll('.sayit-search__submit');
	for (var si = 0; si < searchSubmitButtons.length; si++) {
		searchSubmitButtons[si].addEventListener('click', function () {
			submitSearch(input.value);
		});
	}
	for (var sb = 0; sb < searchSubmitButtons.length; sb++) searchSubmitButtons[sb].hidden = false;

	window.addEventListener('sayit-lang-change', refreshSearchI18n);

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
	function resolveAskBaseUrl() {
		var host = window.location.hostname;
		var isDevHost = host === 'localhost' || host === '127.0.0.1';
		if (isDevHost) {
			try {
				var params = new URLSearchParams(window.location.search);
				var override = params.get('ask_base');
				if (override) return override.replace(/\/$/, '');
			} catch { /* ignore */ }
			return window.location.origin;
		}
		return 'https://ask.archive.tw';
	}
	var ASK_BASE_URL = resolveAskBaseUrl();

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
		} catch {
			return false;
		}
	}



	// Ask backend sometimes returns raw HTML anchors in otherwise-markdown text.
	// Extract them before escapeHtml and re-inject sanitized <a> tags so labels
	// cannot inject markdown link syntax (issue #141).
	function extractAskInlineHtmlAnchors(text) {
		var anchors = [];
		var withPlaceholders = String(text || '').replace(
			/<a\b[^>]*\bhref\s*=\s*(["'])([^"'>\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
			function (_m, _quote, href, label) {
				var cleanLabel = String(label).replace(/<[^>]+>/g, '').trim() || href;
				var id = anchors.length;
				anchors.push({ href: href, label: cleanLabel });
				return '\u0000ASKA' + id + '\u0000';
			}
		);
		return { text: withPlaceholders, anchors: anchors };
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


	function askHasVisibleAnswer() {
		return !!(askAnswer && !askAnswer.hidden && (lastAskMarkdown || '').trim());
	}

	function copyMarkdownText(text) {
		if (!text) return Promise.resolve(false);
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
			}
		} catch { /* clipboard write unsupported or denied; fall through to the execCommand fallback below */ }
		try {
			var textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.setAttribute('readonly', '');
			textarea.style.position = 'fixed';
			textarea.style.inset = '0 auto auto 0';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			var ok = document.execCommand('copy');
			textarea.remove();
			return Promise.resolve(!!ok);
		} catch {
			return Promise.resolve(false);
		}
	}

	function bindAskCopyButton() {
		if (!askAnswer || askAnswer.dataset.sayitCopyBound) return;
		askAnswer.dataset.sayitCopyBound = '1';
		askAnswer.addEventListener('click', function (e) {
			var btn = e.target && e.target.closest ? e.target.closest('[data-sayit-ask-copy]') : null;
			if (!btn || btn.disabled) return;
			var text = lastAskMarkdown || '';
			if (!text.trim()) return;
			void copyMarkdownText(text).then(function (ok) {
				btn.textContent = ok ? askT.copiedMarkdown : askT.copyFailed;
				if (askCopyResetTimer) clearTimeout(askCopyResetTimer);
				askCopyResetTimer = setTimeout(function () {
					btn.textContent = askT.copyMarkdown;
					askCopyResetTimer = null;
				}, 2000);
			});
		});
	}

	function isTableSeparatorLine(line) {
		return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
	}

	function parseTableRow(line) {
		var trimmed = line.trim();
		if (!trimmed) return null;
		var inner = trimmed;
		if (inner.charAt(0) === '|') inner = inner.slice(1);
		if (inner.charAt(inner.length - 1) === '|') inner = inner.slice(0, -1);
		return inner.split('|').map(function (cell) { return cell.trim(); });
	}

	function renderAskInlineMarkdown(text, hrefByIndex) {
		var extracted = extractAskInlineHtmlAnchors(text || '');
		var html = escapeHtml(extracted.text);
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, function (_m, label, href) {
			if (!isSafeHttpUrl(href)) return escapeHtml(label);
			return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
		});
		if (hrefByIndex) {
			html = html.replace(/\[\^(\d+)\]/g, function (_m, num) {
				var href = hrefByIndex[Number(num)];
				if (!href) return escapeHtml('[' + num + ']');
				return '<sup class="cite"><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">[' + escapeHtml(num) + ']</a></sup>';
			});
		}
		// Restore extracted HTML anchors as sanitized links (or plain text if unsafe).
		// oxlint-disable-next-line no-control-regex -- intentional NUL sentinel placeholder, mirrors extractAskInlineHtmlAnchors' marker format
		html = html.replace(/\u0000ASKA(\d+)\u0000/g, function (_m, id) {
			var item = extracted.anchors[Number(id)];
			if (!item) return '';
			if (!isSafeHttpUrl(item.href)) return escapeHtml(item.label);
			return '<a href="' + escapeHtml(item.href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.label) + '</a>';
		});
		return html;
	}

	function renderAskTable(lines, start, hrefByIndex) {
		var header = parseTableRow(lines[start]);
		if (!header || header.length === 0) return null;
		if (start + 1 >= lines.length || !isTableSeparatorLine(lines[start + 1])) return null;
		var rows = [];
		var idx = start + 2;
		while (idx < lines.length) {
			var rowLine = lines[idx];
			if (!rowLine.trim() || rowLine.indexOf('|') === -1) break;
			if (isTableSeparatorLine(rowLine)) break;
			var row = parseTableRow(rowLine);
			if (!row || row.length === 0) break;
			rows.push(row);
			idx += 1;
		}
		var colCount = header.length;
		var html = '<div class="homepage-ask-answer__table-wrap"><table class="homepage-ask-answer__table"><thead><tr>';
		for (var h = 0; h < header.length; h++) {
			html += '<th scope="col">' + renderAskInlineMarkdown(header[h], hrefByIndex) + '</th>';
		}
		html += '</tr></thead><tbody>';
		for (var r = 0; r < rows.length; r++) {
			html += '<tr>';
			for (var c = 0; c < colCount; c++) {
				html += '<td>' + renderAskInlineMarkdown(rows[r][c] || '', hrefByIndex) + '</td>';
			}
			html += '</tr>';
		}
		html += '</tbody></table></div>';
		return { html: html, next: idx };
	}

	function parseListItemLine(line) {
		var ul = line.match(/^(\s*)[-*+]\s+(.+)$/);
		if (ul) return { type: 'ul', indent: ul[1].length, text: ul[2] };
		var ol = line.match(/^(\s*)\d+\.\s+(.+)$/);
		if (ol) return { type: 'ol', indent: ol[1].length, text: ol[2] };
		return null;
	}

	function renderAskList(lines, start, hrefByIndex) {
		var first = parseListItemLine(lines[start]);
		if (!first) return null;
		var listType = first.type;
		var items = [];
		var idx = start;
		while (idx < lines.length) {
			var item = parseListItemLine(lines[idx]);
			if (!item || item.type !== listType) break;
			items.push(item.text);
			idx += 1;
		}
		if (!items.length) return null;
		var tag = listType === 'ol' ? 'ol' : 'ul';
		var html = '<' + tag + ' class="homepage-ask-answer__list">';
		for (var k = 0; k < items.length; k++) {
			html += '<li>' + renderAskInlineMarkdown(items[k], hrefByIndex) + '</li>';
		}
		html += '</' + tag + '>';
		return { html: html, next: idx };
	}
	function renderAskBodyBlocks(body, hrefByIndex) {
		var lines = body.split('\n');
		var blocks = [];
		var i = 0;
		while (i < lines.length) {
			var line = lines[i];
			if (!line.trim()) {
				i += 1;
				continue;
			}
			var heading = line.match(/^(#{1,6})\s+(.+)$/);
			if (heading) {
				var level = Math.min(6, heading[1].length);
				blocks.push('<h' + level + '>' + renderAskInlineMarkdown(heading[2].trim(), hrefByIndex) + '</h' + level + '>');
				i += 1;
				continue;
			}
			var table = renderAskTable(lines, i, hrefByIndex);
			if (table) {
				blocks.push(table.html);
				i = table.next;
				continue;
			}
			var list = renderAskList(lines, i, hrefByIndex);
			if (list) {
				blocks.push(list.html);
				i = list.next;
				continue;
			}
			var paraLines = [];
			while (i < lines.length && lines[i].trim()) {
				if (/^(#{1,6})\s+/.test(lines[i])) break;
				if (renderAskTable(lines, i, hrefByIndex)) break;
				if (parseListItemLine(lines[i])) break;
				paraLines.push(lines[i]);
				i += 1;
			}
			if (paraLines.length) {
				blocks.push('<p>' + renderAskInlineMarkdown(paraLines.join(' '), hrefByIndex) + '</p>');
			}
		}
		return blocks.join('');
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

		var html = renderAskBodyBlocks(body, hrefByIndex);
		return { html: sanitizeHtml(html), sources: sources };
	}

	function showResults() {
		if (!results) return;
		results.hidden = false;
		if (speechList) speechList.style.display = 'none';
	}

	function hideResults() {
		if (!results) return;
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
		lastAskMarkdown = '';
	}

	function setAskStatus(message) {
		if (askStatus) askStatus.textContent = message || '';
	}

	function consentAccepted() {
		return true;
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
		bindAskCopyButton();
		askAnswer.hidden = false;
		if (error) {
			lastAskMarkdown = '';
			askAnswer.innerHTML = '<p class="homepage-ask-answer__error">' + sanitizeHtml(escapeHtml(error)) + '</p>';
			return;
		}

		lastAskMarkdown = raw || '';
		var parsed = parseAskAnswer(raw);
		var html = '';
		if ((raw || '').trim()) {
			html += '<div class="homepage-ask-answer__toolbar"><button type="button" class="homepage-ask-answer__copy" data-sayit-ask-copy aria-label="' + escapeHtml(askT.copyMarkdown) + '">' + escapeHtml(askT.copyMarkdown) + '</button></div>';
		}
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
		if (!results) return;
		if (!query.trim()) {
			hideResults();
			return;
		}

		currentQuery = query;
		currentSearchResults = null;
		displayedCount = 0;
		renderLoading();

		ensureWorker(true);

		void searchViaWorker(query, 100).then(function (msg) {
			if (query !== currentQuery) return;

			if (msg.type === 'error') {
				console.error('Search worker failed', msg.message || 'unknown error');
				renderError();
				return;
			}

			if (!msg.results || msg.results.length === 0) {
				if (!askHasVisibleAnswer()) renderNoResults(query);
				else hideResults();
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
		var endpoint = ASK_BASE_URL + '/au/' + encodeURIComponent(question);
		return isZh ? endpoint : endpoint + '?lang=en';
	}

	function parseRetryAfter(response) {
		var retryAfter = Number(response.headers.get('Retry-After'));
		return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 0;
	}

	function runAsk(question) {
		var query = (question || '').trim();
		if (!askAvailable || !query || askLoading || askCooldownRemaining > 0) return Promise.resolve();
		if (query.length > 100) {
			renderAskAnswer('', false, askT.questionTooLong);
			return Promise.resolve();
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

		return fetch(askEndpointForQuestion(query), { signal: askAbortController.signal }).then(function (response) {
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
		if (!askAnswer || !window.fetch) return Promise.resolve();
		var deadline = Date.now() + 15000;
		function wait(ms) {
			return new Promise(function (resolve) { setTimeout(resolve, ms); });
		}
		function probeCapacity() {
			return fetch(ASK_BASE_URL + '/capacity', { headers: { Accept: 'application/json' } }).then(function (response) {
				if (response.ok) return response.json();
				if (response.status >= 400 && response.status < 500 && response.status !== 429) return null;
				var retryAfter = response.status === 429 ? parseRetryAfter(response) * 1000 : 500;
				if (Date.now() + retryAfter >= deadline) return null;
				return wait(Math.max(retryAfter, 250)).then(probeCapacity);
			}).catch(function () {
				if (Date.now() + 500 >= deadline) return null;
				return wait(500).then(probeCapacity);
			});
		}
		var capacityPromise = probeCapacity().then(function (data) {
			if (!data || data.status !== 'available') return;
			askAvailable = true;
			if (askPanel) askPanel.hidden = false;
			for (var sb = 0; sb < searchSubmitButtons.length; sb++) searchSubmitButtons[sb].hidden = false;
			updateAskControls();
		}).catch(function () {
			askAvailable = false;
		});

		if (askPanel) {
			var samples = askPanel.querySelectorAll('[data-sayit-ask-question]');
			for (var i = 0; i < samples.length; i++) {
				samples[i].addEventListener('click', function (event) {
					var question = event.currentTarget.getAttribute('data-sayit-ask-question') || '';
					submitSearch(question);
				});
			}
		}

		return capacityPromise;
	}

	function submitSearch(query) {
		var q = (query || '').trim();
		if (!q) return;

		var onSearchResults = window.location.pathname === '/search/';

		if (askAnswer && askAvailable && q.length <= 100 && !askLoading && askCooldownRemaining <= 0) {
			void runAiFirstSearch(q, onSearchResults);
			return;
		}

		if (askAnswer) {
			if (onSearchResults) return;
			hideAskAnswer();
			doSearch(q);
			return;
		}

		if (!results) return;
		hideAskAnswer();
		doSearch(q);
	}

	function runAiFirstSearch(query, skipRegularResults) {
		hideResults();
		return runAsk(query).then(function () {
			if (!skipRegularResults) doSearch(query);
		});
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
	});

	input.addEventListener('keydown', function (e) {
		if (e.key === 'Enter') {
			if (e.isComposing || e.keyCode === 229) return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			e.preventDefault();
			submitSearch(input.value);
			return;
		}
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

	void initAsk().finally(function () {
		if (!results || window.location.pathname !== '/search/') return;
		var initialQuery = new URLSearchParams(window.location.search).get('q') || '';
		if (!initialQuery.trim()) return;
		input.value = initialQuery;
		updateAskControls();
		submitSearch(initialQuery);
	});
})();
