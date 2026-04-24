'use strict';
'require view';
'require fs';
'require poll';
'require ui';

function callHelper(action, args) {
	return fs.exec('/usr/libexec/AdGuardHome/luci-helper.sh', [ action ].concat(args || []));
}

function toLocalTime(text) {
	return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g, function(token) {
		var dt = new Date(token);

		if (isNaN(dt.getTime()))
			return token;

		var tzMin = -dt.getTimezoneOffset();
		var sign = tzMin >= 0 ? '+' : '-';
		var absMin = Math.abs(tzMin);
		var tzHours = String(Math.floor(absMin / 60)).padStart(2, '0');
		var tzMins = String(absMin % 60).padStart(2, '0');
		var datePart = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
		var timePart = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') + ':' + String(dt.getSeconds()).padStart(2, '0');

		return datePart + ' ' + timePart + ' ' + sign + tzHours + ':' + tzMins;
	});
}

return view.extend({
	render: function() {
		var reverse = false;
		var useLocalTime = false;
		var rawLogText = '';
		var logPageToken = 'logjs_' + String(Date.now()) + '_' + String(Math.floor(Math.random() * 100000));
		var ta = E('textarea', {
			id: 'adh-log',
			readonly: 'readonly',
			style: 'width:100%;min-height:420px;'
		});

		function renderLog() {
			var output = useLocalTime ? toLocalTime(rawLogText) : rawLogText;
			ta.value = reverse ? output.split('\n').reverse().join('\n') : output;
		}

		var reverseTag = E('label', { style: 'display:block;margin-bottom:6px;' }, [
			E('input', {
				type: 'checkbox',
				'change': function(ev) {
					reverse = ev.target.checked;
					renderLog();
				}
			}),
			' ',
			_('reverse')
		]);

		var localTimeTag = E('label', { style: 'display:block;margin-bottom:6px;' }, [
			E('input', {
				type: 'checkbox',
				'change': function(ev) {
					useLocalTime = ev.target.checked;
					renderLog();
				}
			}),
			' ',
			_('localtime')
		]);

		var clearBtn = E('button', {
			'class': 'btn cbi-button cbi-button-negative',
			'click': ui.createHandlerFn(this, function() {
				rawLogText = '';
				renderLog();
				return callHelper('del_log');
			})
		}, [ _('Delete log') ]);

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
				if (res.stdout) {
					rawLogText += res.stdout;
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