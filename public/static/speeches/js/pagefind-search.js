(function () {
	'use strict';

	var input = document.getElementById('sayit-search-input');
	var results = document.getElementById('sayit-search-results');
	var shortcutBadge = document.getElementById('sayit-search-shortcut');
	var speechList = document.getElementById('sayit-speech-list');
	if (!input || !results) return;

	// Bilingual placeholders
	var isZh = document.documentElement.classList.contains('lang-zh');
	input.setAttribute('placeholder', isZh ? '搜尋對話內容…' : 'Search speeches…');
	if (isZh) input.setAttribute('aria-label', '搜尋對話');

	var pagefindInstance = null;
	var debounceTimer = null;
	var currentQuery = '';
	var MAX_RESULTS = 12;

	// Lazy-load Pagefind on first interaction
	function ensurePagefind() {
		if (pagefindInstance) return pagefindInstance;
		pagefindInstance = import('/pagefind/pagefind.js').then(function (pf) {
			pf.init();
			return pf;
		}).catch(function (err) {
			console.error('[sayit-search] Failed to load Pagefind:', err);
			pagefindInstance = null;
			return null;
		});
		return pagefindInstance;
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
		var title = data.meta && data.meta.title ? data.meta.title : data.url;
		var date = data.meta && data.meta.date ? data.meta.date : '';
		var speaker = data.meta && data.meta.speaker ? data.meta.speaker : '';
		var excerpt = data.excerpt || '';
		var subs = data.sub_results || [];

		// Strip date prefix from title since date is shown separately in meta
		var displayTitle = date ? title.replace(new RegExp('^' + date + '\\s*'), '') : title;

		var metaParts = [];
		if (date) metaParts.push('<span>' + escapeHtml(date) + '</span>');
		if (speaker) metaParts.push('<span>' + escapeHtml(speaker) + '</span>');

		var html =
			'<div class="sayit-search__result">' +
			'<a href="' + escapeHtml(data.url) + '" class="sayit-search__result-title">' + escapeHtml(displayTitle) + '</a>' +
			(metaParts.length > 0
				? '<div class="sayit-search__result-meta">' + metaParts.join('<span aria-hidden="true"> \u00b7 </span>') + '</div>'
				: '');

		if (subs.length > 0) {
			html += '<div class="sayit-search__sub-results">';
			for (var i = 0; i < subs.length; i++) {
				var sub = subs[i];
				var subExcerpt = sub.excerpt || '';
				if (subExcerpt) {
					html +=
						'<a href="' + escapeHtml(sub.url) + '" class="sayit-search__sub-result">' +
						'<span class="sayit-search__sub-result-excerpt">' + subExcerpt + '</span>' +
						'</a>';
				}
			}
			html += '</div>';
		} else if (excerpt) {
			html += '<div class="sayit-search__result-excerpt">' + excerpt + '</div>';
		}

		html += '</div>';
		return html;
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
			'<div class="sayit-search__status">' + escapeHtml(countText) + '</div>';

		for (var i = 0; i < items.length; i++) {
			html += renderResultItem(items[i]);
		}

		if (totalCount > MAX_RESULTS) {
			html +=
				'<a href="/search/?q=' + encodeURIComponent(query) + '" class="sayit-search__more">' +
				(isZh
					? '查看全部 ' + totalCount + ' 筆結果 \u2192'
					: 'View all ' + totalCount + ' results \u2192') +
				'</a>';
		}

		html += '</div>';
		results.innerHTML = html;
	}

	async function doSearch(query) {
		if (!query.trim()) {
			hideResults();
			return;
		}

		currentQuery = query;
		renderLoading();

		var pf = await ensurePagefind();
		if (!pf) {
			renderError();
			return;
		}

		// Guard against stale results
		if (query !== currentQuery) return;

		var search;
		try {
			search = await pf.search(query);
		} catch (err) {
			console.error('[sayit-search] Search error:', err);
			renderNoResults(query);
			return;
		}

		if (query !== currentQuery) return;

		if (!search.results || search.results.length === 0) {
			renderNoResults(query);
			return;
		}

		var totalCount = search.results.length;
		var slice = search.results.slice(0, MAX_RESULTS);

		try {
			var dataPromises = slice.map(function (r) { return r.data(); });
			var items = await Promise.all(dataPromises);

			if (query !== currentQuery) return;
			renderResults(items, query, totalCount);
		} catch (err) {
			console.error('[sayit-search] Data fetch error:', err);
			renderNoResults(query);
		}
	}

	// Input handler with debounce
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

	// Clear on Escape
	input.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			input.value = '';
			input.blur();
			hideResults();
			currentQuery = '';
			clearTimeout(debounceTimer);
		}
	});

	// / keyboard shortcut to focus search
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

	// Hide shortcut badge when focused
	input.addEventListener('focus', function () {
		if (shortcutBadge) shortcutBadge.style.opacity = '0';
		// Preload Pagefind on first focus
		ensurePagefind();
	});

	input.addEventListener('blur', function () {
		if (shortcutBadge && !input.value) shortcutBadge.style.opacity = '1';
	});
})();
