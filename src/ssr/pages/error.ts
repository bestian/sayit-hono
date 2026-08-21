import { renderHtml } from '../render';
import Footer, { styles as FooterStyles } from '../../components/Footer.vue';
import Navbar, { styles as NavbarStyles } from '../../components/Navbar.vue';
import ErrorView, { styles as ErrorViewStyles } from '../../views/ErrorView.vue';
import type { AppContext } from './shared';

type ErrorStatus = 400 | 404;

const ERROR_TITLES: Record<ErrorStatus, string> = {
	400: '無效的網址 · Invalid address',
	404: '找不到這一頁 · Page not found',
};

// 使用者導向的 HTML 錯誤頁：只給確定性的 400/404；API 與 500 一律維持純文字。
export async function renderErrorPage(c: AppContext, status: ErrorStatus): Promise<Response> {
	const styles = [ErrorViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const html = await renderHtml(ErrorView, {
		title: ERROR_TITLES[status],
		styles,
		components: { Navbar, Footer },
		props: { status },
	});
	return c.html(html, status);
}
