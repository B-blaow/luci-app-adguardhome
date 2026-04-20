'use strict';
'require view';
'require fs';
'require poll';
'require ui';

function callHelper(action, args) {
	return fs.exec('/usr/libexec/AdGuardHome/luci-helper.sh', [ action ].concat(args || []));
}

return view.extend({
	render: function() {
		var reverse = false;
		var ta = E('textarea', {
			id: 'adh-log',
			readonly: 'readonly',
			style: 'width:100%;min-height:420px;'
		});

		var reverseTag = E('label', { style: 'display:block;margin-bottom:6px;' }, [
			E('input', {
				type: 'checkbox',
				'change': function(ev) {
					reverse = ev.target.checked;
					ta.value = ta.value.split('\n').reverse().join('\n');
				}
			}),
			' ',
			_('Reverse output')
		]);

		var clearBtn = E('button', {
			'class': 'btn cbi-button cbi-button-negative',
			'click': ui.createHandlerFn(this, function() {
				ta.value = '';
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
			return callHelper('get_log').then(function(res) {
				if (res.stdout) {
					if (reverse)
						ta.value = res.stdout + ta.value;
					else
						ta.value += res.stdout;
				}
			});
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', _('Runtime Log')),
			E('div', { 'class': 'cbi-section-descr' }, _('Real-time log output refreshes every 5 seconds.')),
			reverseTag,
			ta,
			E('div', { style: 'margin-top:8px;display:flex;gap:8px;' }, [ clearBtn, downloadBtn ])
		]);
	}
});
