"use strict";window.games247.privacyControls=(()=>{let e=document.createElement("div");var o,t=document.createElement("style");let c,n,i,s;function r(){e.style.display="block",c.checked=games247.privacy.isConsented("performance"),n.checked=games247.privacy.isConsented("targeting"),i.checked=games247.privacy.isConsented("functionality"),s.checked=games247.privacy.isConsented("unclassified"),document.documentElement.classList.add("privacy-controls-open")}function a(){e.style.display="none",document.documentElement.classList.remove("privacy-controls-open"),window.dispatchEvent(new Event("resize"))}return e.innerHTML=`
	<div class="privacy-controls">
		<p><strong>This website uses cookies</strong></p>
		<p>This website uses cookies to improve user experience. By using our website you consent to all cookies in accordance with our Cookie Policy. <a target="_blank" href="cookie-policy.html">Cookie Policy<a></p>
		<p><strong><u>COOKIE CATEGORIES</u></strong></p>
		<p>Please choose which cookie categories you accept below:</p>
		<div>
			<p><input type="checkbox" checked disabled>&nbsp;<strong>Strictly Necessary</strong></p>
			<p>Strictly necessary cookies allow core website functionality such as user login and account management. The website cannot be used properly without strictly necessary cookies. These cannot be turned off.</p>
		</div>
		<div>
			<p><input class="cc-perf" type="checkbox">&nbsp;<strong>Performance</strong></p>
			<p>Performance cookies are used to see how visitors use the website, eg. analytics cookies. Those cookies cannot be used to directly identify a certain visitor.</p>
		</div>
		<div>
			<p><input class="cc-targ" type="checkbox">&nbsp;<strong>Targeting</strong></p>
			<p>Targeting cookies are used to identify visitors between different websites, eg. content partners, banner networks. Those cookies may be used by companies to build a profile of visitor interests or show relevant ads on other websites.</p>
		</div>
		<div>
			<p><input class="cc-func" type="checkbox">&nbsp;<strong>Functionality</strong></p>
			<p>Functionality cookies are used to remember visitor information on the website, eg. language, timezone, enhanced content.</p>
		</div>
		<div>
			<p><input class="cc-uncl" type="checkbox">&nbsp;<strong>Unclassified</strong></p>
			<p>Unclassified cookies are cookies that do not belong to any other category or are in the process of categorization.</p>
		</div>
		<div>
			<div class="privacy-controls-btn accept">Allow All</div>
			<div class="privacy-controls-btn save">Save</div>
		</div>
	</div>
	`,e=e.children.item(0),document.body.appendChild(e),t.innerText=`
	.privacy-controls
	{
		display: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: white;
	
		overflow-y: auto;
	
		padding: 16px;
		padding-bottom: 32px;
		z-index: 999999;
	}
	.privacy-controls input
	{
		display: inline-block;
	}
	.privacy-controls-btn
	{
		float: left;
	
		border-radius: 16px;
		padding: 10px 20px;
		text-transform: uppercase;
	
		cursor: pointer;
	
		border: solid 1px #CCCCCC;
	
		margin: 8px;
	}
	.privacy-controls-btn.accept
	{
		float: right;
		font-weight: bold;
		color: #FFFFFF;
		border: solid 2px #4CAF50;
		box-shadow: 0px 3px 0px rgba(0, 0, 0, 0.2);
		background: #4CAF50;
	}
	
	html.privacy-controls-open,
	html.privacy-controls-open body
	{
		width: 100% !important;
		height: 100% !important;
		overflow: hidden !important;
	}
	`,document.head.appendChild(t),c=document.querySelector(".privacy-controls .cc-perf"),n=document.querySelector(".privacy-controls .cc-targ"),i=document.querySelector(".privacy-controls .cc-func"),s=document.querySelector(".privacy-controls .cc-uncl"),t=document.querySelector(".privacy-controls-btn.accept"),o=document.querySelector(".privacy-controls-btn.save"),o.addEventListener("click",()=>{games247.privacy.setLocalConsent(c.checked,n.checked,i.checked,s.checked),a()}),t.addEventListener("click",()=>{games247.privacy.setLocalConsent(!0,!0,!0,!0),a()}),r(),{open:r}})();