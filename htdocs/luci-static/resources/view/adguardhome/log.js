'use strict';
'require view';
'require fs';
'require poll';
'require ui';

function callHelper(action, args) {
	return fs.exec('/usr/libexec/AdGuardHome/luci-helper.sh', [ action ].concat(args || []));
}

function formatLocalDate(dt, fraction) {
	var tzMin = -dt.getTimezoneOffset();
	var sign = tzMin >= 0 ? '+' : '-';
	var absMin = Math.abs(tzMin);
	var tzHours = String(Math.floor(absMin / 60)).padStart(2, '0');
	var tzMins = String(absMin % 60).padStart(2, '0');
	var datePart = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
	var timePart = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') + ':' + String(dt.getSeconds()).padStart(2, '0');

	return datePart + ' ' + timePart + (fraction ? fraction : '') + ' ' + sign + tzHours + ':' + tzMins;
}

function toLocalTime(text) {
	text = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g, function(token, fraction) {
		var normalized = token.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
		var dt = new Date(normalized);

		if (isNaN(dt.getTime()))
			return token;

		return formatLocalDate(dt, fraction || '');
	});

	return text.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?/g, function(token, y, m, d, hh, mm, ss, fraction) {
		var dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));

		if (isNaN(dt.getTime()))
			return token;

		return formatLocalDate(dt, fraction || '');
	});
}


return view.extend({
	render: function() {
		var reverse = false;
		var useLocalTime = false;
		var rawLogText = '';
		var logState = 'ok';
		var logPageToken = 'logjs_' + String(Date.now()) + '_' + String(Math.floor(Math.random() * 100000));
		var ta = E('textarea', {
			id: 'adh-log',
			readonly: 'readonly',
			style: 'width:100%;min-height:420px;'
		});

		function renderLog() {
			if (logState === 'no_file') {
				ta.value = _('No log file');
				return;
			}
			if (!rawLogText.trim()) {
				ta.value = _('No logs');
				return;
			}

			var output = useLocalTime ? toLocalTime(rawLogText) : rawLogText;
			ta.value = reverse ? output.split('\n').reverse().join('\n') : output;
		}

		var reverseTag = E('label', { style: 'display:inline-flex;align-items:center;gap:4px;' }, [
			E('input', {
				type: 'checkbox',
				'change': function(ev) {
					reverse = ev.target.checked;
					renderLog();
				}
			}),
			_('reverse')
		]);

		var localTimeTag = E('label', { style: 'display:inline-flex;align-items:center;gap:4px;' }, [
			E('input', {
				type: 'checkbox',
				'change': function(ev) {
					useLocalTime = ev.target.checked;
					renderLog();
				}
			}),
			_('localtime')
		]);

		var clearBtn = E('button', {
			'class': 'btn cbi-button cbi-button-negative',
			'click': ui.createHandlerFn(this, function() {
				rawLogText = '';
				logState = 'empty';
				renderLog();
				return callHelper('del_log');
			})
		}, [ _('dellog') ]);

		var downloadBtn = E('button', {
			'class': 'btn cbi-button',
			'click': function() {
				var aTag = document.createElement('a');
				var dt = new Date();
				var timestamp = (dt.getMonth() + 1) + '-' + dt.getDate() + '-' + dt.getHours() + '_' + dt.getMinutes();
				var blob = new Blob([ ta.value ]);
				aTag.download = 'AdGuardHome-' + timestamp + '.log';
				aTag.href = URL.createObjectURL(blob);
				aTag.click();
				URL.revokeObjectURL(blob);
			}
		}, [ _('Download log') ]);

		poll.add(function() {
			return callHelper('get_log', [ logPageToken ]).then(function(res) {
				var output = (res.stdout || '').trim();
				if (output === '__ADH_NO_LOG_FILE__') {
					logState = 'no_file';
					rawLogText = '';
					renderLog();
					return;
				}
				if (output === '__ADH_EMPTY_LOG__') {
					logState = 'empty';
					rawLogText = '';
					renderLog();
					return;
				}
				if (res.stdout) {
					logState = 'ok';
					rawLogText += res.stdout;
					var lines = rawLogText.split('\n');
					if (lines.length > 1000)
						rawLogText = lines.slice(lines.length - 1000).join('\n');
					renderLog();
				}
			});
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', _('Runtime Log')),
			E('div', { 'class': 'cbi-section-descr' }, _('Real-time log output refreshes every 5 seconds.')),
			reverseTag,
			localTimeTag,
			ta,
			E('div', { style: 'margin-top:8px;display:flex;gap:8px;' }, [ clearBtn, downloadBtn ])
		]);
	}
});