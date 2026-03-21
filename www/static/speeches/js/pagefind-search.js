(function () {
	'use strict';

	var input = document.getElementById('sayit-search-input');
	var results = document.getElementById('sayit-search-results');
	var shortcutBadge = document.getElementById('sayit-search-shortcut');
	var speechList = document.getElementById('sayit-speech-list');
	if (!input || !results) return;

	var isZh = document.documentElement.classList.contains('lang-zh');
	input.setAttribute('placeholder', isZh ? '搜尋對話內容…' : 'Search speeches…');
	if (isZh) input.setAttribute('aria-label', '搜尋對話');

	var worker = null;
	var debounceTimer = null;
	var currentQuery = '';
	var PAGE_SIZE = 12;
	var currentSearchResults = null;
	var displayedCount = 0;
	var requestId = 0;
	var pendingResolves = {};

	function ensureWorker() {
		if (worker) return;
		worker = new Worker('/static/speeches/js/fuse-search.worker.js');
		worker.addEventListener('message', function (e) {
			var msg = e.data;
			if (msg.requestId != null && pendingResolves[msg.requestId]) {
				pendingResolves[msg.requestId](msg);
				delete pendingResolves[msg.requestId];
			}
		});
		// Warmup: trigger index fetch
		worker.postMessage({ type: 'warmup' });
	}

	function searchViaWorker(query, limit) {
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

	function renderResultItem(data) {
		var title = data.title || data.url;
		var date = data.date || '';
		var speaker = data.speaker || '';
		var snippet = data.snippet || '';

		var displayTitle = date ? title.replace(new RegExp('^' + date + '\\s*'), '') : title;

		var metaParts = [];
		if (date) metaParts.push('<span>' + escapeHtml(date) + '</span>');
		if (speaker) metaParts.push('<span>' + escapeHtml(speaker) + '</span>');

		var html =
			'<a href="' + escapeHtml(data.url) + '" class="sayit-search__result">' +
			'<div class="sayit-search__result-title">' + escapeHtml(displayTitle) + '</div>' +
			(metaParts.length > 0
				? '<div class="sayit-search__result-meta">' + metaParts.join('<span aria-hidden="true"> \u00b7 </span>') + '</div>'
				: '');

		if (snippet) {
			html += '<div class="sayit-search__result-excerpt">' + escapeHtml(snippet) + '</div>';
		}

		html += '</a>';
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
				container.insertAdjacentHTML('beforeend', renderResultItem(nextSlice[i]));
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

	function renderResults(items, query, totalCount) {
		if (items.length === 0) {
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

		for (var i = 0; i < items.length; i++) {
			html += renderResultItem(items[i]);
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

		currentQuery = query;
		currentSearchResults = null;
		displayedCount = 0;
		renderLoading();

		ensureWorker();

		searchViaWorker(query, 100).then(function (msg) {
			if (query !== currentQuery) return;

			if (msg.type === 'error') {
				renderError();
				return;
			}

			if (!msg.results || msg.results.length === 0) {
				renderNoResults(query);
				return;
			}

			currentSearchResults = msg.results;
			var firstPage = msg.results.slice(0, PAGE_SIZE);
			displayedCount = firstPage.length;
			renderResults(firstPage, query, msg.results.length);
		});
	}

	input.addEventListener('input', function () {
		clearTimeout(debounceTimer);
		var query = input.value;
		if (!query.trim()) {
			hideResults();
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
			currentQuery = '';
			clearTimeout(debounceTimer);
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
		ensureWorker();
	});

	input.addEventListener('blur', function () {
		if (shortcutBadge && !input.value) shortcutBadge.style.opacity = '1';
	});

	// --- Speaker-page search ---
	var speakerForm = document.querySelector('.speaker-page__search form');
	if (speakerForm) {
		var speakerInput = speakerForm.querySelector('input[type="search"]');
		var speakerH1 = document.querySelector('.speaker-information h1');
		var speakerName = speakerH1 ? speakerH1.textContent.trim() : '';
		var speechesList = document.querySelector('.speaker-page__speeches-collection .js-masonry');
		var pagination = document.querySelector('.speaker-page__speeches-collection .pagination');
		var speakerResults = null;
		var speakerDebounce = null;
		var speakerCurrentQuery = '';
		var speakerSearchResults = null;
		var speakerDisplayed = 0;

		function getSpeakerResultsContainer() {
			if (!speakerResults) {
				speakerResults = document.createElement('div');
				speakerResults.className = 'sayit-search__results';
				speakerResults.setAttribute('aria-live', 'polite');
				speakerResults.hidden = true;
				var parent = speechesList ? speechesList.parentNode : speakerForm.closest('.speaker-page__speeches-collection');
				if (speechesList) parent.insertBefore(speakerResults, speechesList);
				else parent.appendChild(speakerResults);
			}
			return speakerResults;
		}

		function showSpeakerResults() {
			getSpeakerResultsContainer().hidden = false;
			if (speechesList) speechesList.style.display = 'none';
			if (pagination) pagination.style.display = 'none';
		}

		function hideSpeakerResults() {
			if (speakerResults) {
				speakerResults.hidden = true;
				speakerResults.innerHTML = '';
			}
			if (speechesList) speechesList.style.display = '';
			if (pagination) pagination.style.display = '';
			speakerSearchResults = null;
			speakerDisplayed = 0;
		}

		function speakerLoadMore() {
			if (!speakerSearchResults || speakerDisplayed >= speakerSearchResults.length) return;
			var btn = document.getElementById('sayit-speaker-search-more');
			var container = document.getElementById('sayit-speaker-search-items');
			var next = speakerSearchResults.slice(speakerDisplayed, speakerDisplayed + PAGE_SIZE);
			if (container) {
				for (var i = 0; i < next.length; i++) {
					container.insertAdjacentHTML('beforeend', renderResultItem(next[i]));
				}
			}
			speakerDisplayed += next.length;
			if (btn) {
				if (speakerDisplayed >= speakerSearchResults.length) btn.remove();
				else btn.textContent = moreButtonText(speakerSearchResults.length - speakerDisplayed);
			}
		}

		function doSpeakerSearch(query) {
			if (!query.trim()) { hideSpeakerResults(); return; }
			speakerCurrentQuery = query;
			speakerSearchResults = null;
			speakerDisplayed = 0;
			showSpeakerResults();
			var rc = getSpeakerResultsContainer();
			rc.innerHTML =
				'<div class="sayit-search__loading">' +
				'<div class="sayit-search__spinner"></div>' +
				'<span>' + (isZh ? '搜尋中…' : 'Searching…') + '</span></div>';

			ensureWorker();
			var id = ++requestId;
			new Promise(function (resolve) {
				pendingResolves[id] = resolve;
				worker.postMessage({ type: 'search', query: query, limit: 200, speakerFilter: speakerName, requestId: id });
			}).then(function (msg) {
				if (query !== speakerCurrentQuery) return;
				if (msg.type === 'error' || !msg.results || msg.results.length === 0) {
					showSpeakerResults();
					rc.innerHTML = '<div class="sayit-search__results-inner"><div class="sayit-search__status">' +
						(msg.type === 'error'
							? (isZh ? '搜尋功能暫時無法使用' : 'Search is currently unavailable')
							: (isZh ? '找不到與「' + escapeHtml(query) + '」相關的結果' : 'No results for \u201c' + escapeHtml(query) + '\u201d')) +
						'</div></div>';
					return;
				}
				speakerSearchResults = msg.results;
				var first = msg.results.slice(0, PAGE_SIZE);
				speakerDisplayed = first.length;
				var countText = isZh
					? '找到 ' + msg.results.length + ' 項結果'
					: msg.results.length + ' result' + (msg.results.length !== 1 ? 's' : '') + ' found';
				var html =
					'<div class="sayit-search__results-inner"><div class="sayit-search__status">' + escapeHtml(countText) + '</div>' +
					'<div id="sayit-speaker-search-items">';
				for (var i = 0; i < first.length; i++) html += renderResultItem(first[i]);
				html += '</div>';
				if (msg.results.length > speakerDisplayed) {
					html += '<button type="button" id="sayit-speaker-search-more" class="sayit-search__more">' +
						moreButtonText(msg.results.length - speakerDisplayed) + '</button>';
				}
				html += '</div>';
				rc.innerHTML = html;
				var moreBtn = document.getElementById('sayit-speaker-search-more');
				if (moreBtn) moreBtn.addEventListener('click', speakerLoadMore);
			});
		}

		speakerForm.addEventListener('submit', function (e) {
			e.preventDefault();
			if (speakerInput) doSpeakerSearch(speakerInput.value);
		});

		if (speakerInput) {
			speakerInput.addEventListener('input', function () {
				clearTimeout(speakerDebounce);
				var q = speakerInput.value;
				if (!q.trim()) { hideSpeakerResults(); speakerCurrentQuery = ''; return; }
				speakerDebounce = setTimeout(function () { doSpeakerSearch(q); }, 250);
			});
			speakerInput.addEventListener('keydown', function (e) {
				if (e.key === 'Escape') {
					speakerInput.value = '';
					speakerInput.blur();
					hideSpeakerResults();
					speakerCurrentQuery = '';
					clearTimeout(speakerDebounce);
				}
			});
		}
	}
})();
