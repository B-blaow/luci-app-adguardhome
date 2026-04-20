'use strict';
'require view';
'require fs';
'require ui';

function callHelper(action, args) {
	return fs.exec('/usr/libexec/AdGuardHome/luci-helper.sh', [ action ].concat(args || []));
}

function loadScript(src) {
	return new Promise(function(resolve, reject) {
		var s = E('script', { src: src });
		s.onload = resolve;
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

function loadCss(href) {
	var link = E('link', { rel: 'stylesheet', href: href });
	document.head.appendChild(link);
}

function ensureCodeMirror() {
	if (window.CodeMirror)
		return Promise.resolve();

	loadCss('/luci-static/resources/codemirror/lib/codemirror.css');
	loadCss('/luci-static/resources/codemirror/theme/dracula.css');
	loadCss('/luci-static/resources/codemirror/addon/fold/foldgutter.css');

	return loadScript('/luci-static/resources/codemirror/lib/codemirror.js')
		.then(function() { return loadScript('/luci-static/resources/codemirror/mode/yaml/yaml.js'); })
		.then(function() { return loadScript('/luci-static/resources/codemirror/addon/fold/foldcode.js'); })
		.then(function() { return loadScript('/luci-static/resources/codemirror/addon/fold/foldgutter.js'); })
		.then(function() { return loadScript('/luci-static/resources/codemirror/addon/fold/indent-fold.js'); });
}

return view.extend({
	load: function() {
		return callHelper('manual_read');
	},

	render: function(data) {
		var initialText = (data && data.stdout) || '';
		var ta = E('textarea', { id: 'adh-manual', style: 'width:100%;min-height:520px;' }, [ initialText ]);
		var editor = null;

		var saveBtn = E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function() {
				var val = editor ? editor.getValue() : ta.value;
				return callHelper('manual_save', [ val ]).then(function(res) {
					ui.addNotification(null, E('p', (res.stdout || '').trim() || _('Saved')));
				}).catch(function(err) {
					ui.addNotification(null, E('p', err.message || _('Save failed')), 'danger');
				});
			})
		}, [ _('Save config') ]);

		var tplBtn = E('button', {
			'class': 'btn cbi-button',
			'click': ui.createHandlerFn(this, function() {
				return callHelper('manual_template').then(function(res) {
					if (editor)
						editor.setValue(res.stdout || '');
					else
						ta.value = res.stdout || '';
				});
			})
		}, [ _('Use template') ]);

		var reloadBtn = E('button', {
			'class': 'btn cbi-button',
			'click': ui.createHandlerFn(this, function() {
				return callHelper('reload_tmp').then(function() {
					return callHelper('manual_read');
				}).then(function(res) {
					if (editor)
						editor.setValue(res.stdout || '');
					else
						ta.value = res.stdout || '';
				});
			})
		}, [ _('Reload config') ]);

		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', _('Manual Config Editor')),
			E('div', { 'class': 'cbi-section-descr' }, _('YAML editor with syntax highlighting.')),
			ta,
			E('div', { style: 'margin-top:8px;display:flex;gap:8px;' }, [ saveBtn, tplBtn, reloadBtn ])
		]);

		ensureCodeMirror().then(function() {
			editor = window.CodeMirror.fromTextArea(ta, {
				mode: 'text/yaml',
				styleActiveLine: true,
				lineNumbers: true,
				theme: 'dracula',
				lineWrapping: true,
				foldGutter: true,
				gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
				matchBrackets: true
			});
		}).catch(function() {
			ui.addNotification(null, E('p', _('CodeMirror not found, fallback to plain textarea.')), 'warning');
		});

		return root;
	}
});
