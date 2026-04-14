'use strict';
'require view';
'require fs';
'require ui';

return view.extend({
	render: function() {
		var self = this;

		self.textarea = E('textarea', {
			style: 'width:100%; height:500px;'
		});

		function loadScript(src) {
			return new Promise((resolve) => {
				let s = document.createElement('script');
				s.src = src;
				s.onload = resolve;
				document.head.appendChild(s);
			});
		}

		function loadCSS(href) {
			let l = document.createElement('link');
			l.rel = 'stylesheet';
			l.href = href;
			document.head.appendChild(l);
		}

		loadCSS('/luci-static/resources/codemirror/lib/codemirror.css');
		loadCSS('/luci-static/resources/codemirror/theme/dracula.css');

		var container = E('div', {}, [
			E('h3', {}, 'Manual Setting'),
			self.textarea,

			E('div', { style: 'margin-top:10px;' }, [
				E('button', {
					class: 'cbi-button cbi-button-positive',
					click: function() {
						var content = self.editor.getValue();
						fs.write('/etc/AdGuardHome.yaml', content).then(() => {
							ui.addNotification(null, E('p', 'Saved'));
						});
					}
				}, 'Use template')
			])
		]);

		Promise.all([
			loadScript('/luci-static/resources/codemirror/lib/codemirror.js'),
			loadScript('/luci-static/resources/codemirror/mode/yaml/yaml.js')
		]).then(function() {

			self.editor = CodeMirror.fromTextArea(self.textarea, {
				mode: 'yaml',
				theme: 'dracula',
				lineNumbers: true,
				lineWrapping: true
			});

			fs.read('/etc/AdGuardHome.yaml').then(function(res) {
				self.editor.setValue(res || '');
			});
		});

		return container;
	}
});
