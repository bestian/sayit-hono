<template>
	<footer class="full-page__row footer">
		<div class="full-page__unit" style="display: flex">
			<div class="row">
				<div class="columns small-12 large-9" style="padding: 0">
					<p class="footer__text" id="cc">
						本站由 唐鳳 維運，除另有標示外，內容以創用 CC0 授權條款釋出<br />
						This site is maintained and operated by Audrey Tang. Unless otherwise indicated, the content is
						released under the terms of the Creative Commons CC0 license.
					</p>
				</div>
				<div class="columns small-12 large-3" style="padding: 0">
					<p class="footer__links">
						<a id="tos"></a>
						<a id="privacy" style="margin-left: 1rem"></a>
					</p>
				</div>
			</div>
		</div>
	</footer>
</template>

<style>
.footer {
	margin-top: 48px;
	padding: 24px 0 32px;
	border-top: 1px solid #e5e7eb;
}

.footer__text {
	font-size: 1em;
	font-weight: bold;
	display: flex;
	margin-inline-end: auto;
}

.footer__links {
	font-size: 1em;
	font-weight: bold;
	display: flex;
	justify-content: end;
}
</style>

