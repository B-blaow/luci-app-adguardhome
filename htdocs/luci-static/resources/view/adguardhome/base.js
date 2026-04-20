'use strict';
'require view';
'require form';
'require fs';
'require poll';
'require uci';
'require ui';

function callHelper(action, args) {
	return fs.exec('/usr/libexec/AdGuardHome/luci-helper.sh', [ action ].concat(args || []));
}

function parseJSON(text, fallback) {
	try { return JSON.parse(text); } catch (e) { return fallback; }
}

function redirectLabel(mode) {
	switch (mode) {
	case 'dnsmasq-upstream':
		return _('Run as dnsmasq upstream server');
	case 'redirect':
		return _('Redirect 53 port to AdGuardHome');
	case 'exchange':
		return _('Use port 53 replace dnsmasq');
	default:
		return _('none');
	}
}

function loadBcrypt() {
	if (window.TwinBcrypt)
		return Promise.resolve();

	return new Promise(function(resolve, reject) {
		var s = E('script', { src: '/luci-static/resources/twin-bcrypt.min.js' });
		s.onload = resolve;
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('AdGuardHome'),
			callHelper('status'),
			callHelper('core_version')
		]);
	},

	render: function(data) {
		var status = parseJSON((data[1] && data[1].stdout) || '{}', { running: false, redirect: false });
		var version = ((data[2] && data[2].stdout) || '').trim() || _('Unknown');
		var redirectMode = uci.get('AdGuardHome', 'AdGuardHome', 'redirect') || 'none';
		var updatePolling = false;
		var m = new form.Map('AdGuardHome', _('AdGuard Home'),
			_('Free and open source, powerful network-wide ads & trackers blocking DNS server.'));
		var s = m.section(form.TypedSection, 'AdGuardHome', _('Base Setting'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.DummyValue, '_status', _('Status'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			var run = status.running ? '<span style="color:var(--success-color-high,#2e7d32)"><strong>' + _('RUNNING') + '</strong></span>' : '<span style="color:var(--error-color-high,#d32f2f)"><strong>' + _('NOT RUNNING') + '</strong></span>';
			var redir = status.redirect ? '<span style="color:var(--success-color-high,#2e7d32)"><strong>' + _('Redirected') + '</strong></span>' : '<span style="color:var(--error-color-high,#d32f2f)"><strong>' + _('Not redirect') + '</strong></span>';
			return 'AdGuardHome ' + run + ' ' + redir + ' | ' + _('Redirect mode') + ': ' + String.format('%h', redirectLabel(redirectMode));
		};

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'httpport', _('Browser management port'));
		o.datatype = 'port';
		o.placeholder = '3000';
		o.description = _('Open Web Interface');

		o = s.option(form.Button, '_open_web', _('Open Web Interface'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			if (!status.running)
				return false;
			var portInput = document.querySelector('input[id$=".httpport"]');
			var port = portInput && portInput.value ? portInput.value : '3000';
			window.open('http://' + window.location.hostname + ':' + port + '/', '_blank');
		};

		o = s.option(form.DummyValue, '_version', _('Current Core Version:'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span style="font-weight:bold;color:var(--primary-color-high,#2e7d32)">' + String.format('%h', version) + '</span>';
		};

		o = s.option(form.DummyValue, '_update_actions', _('Update'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
				+ '<button id="adh-update-btn" class="btn cbi-button cbi-button-apply" type="button">' + _('Update core version') + '</button>'
				+ '<button id="adh-force-update-btn" class="btn cbi-button" type="button">' + _('Force update') + '</button>'
				+ '</div>';
		};

		o = s.option(form.DummyValue, '_updatelog', _('Update output log'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="adh-update-log-wrap" style="display:none">'
				+ '<label style="display:block;margin:0 0 6px 0;"><input id="adh-update-reverse" type="checkbox" /> ' + _('Reverse output') + '</label>'
				+ '<textarea id="adh-update-log" readonly="readonly" style="width:100%;min-height:220px;background:var(--background-color-medium,#1e1e1e);color:var(--text-color-high,#f5f5f5);border:1px solid var(--border-color-medium,#666)"></textarea>'
				+ '</div>';
		};
		o.description = _('Update log will appear here after clicking update.');

		o = s.option(form.ListValue, 'redirect', _('Redirect mode'));
		o.value('none', _('none'));
		o.value('dnsmasq-upstream', _('Run as dnsmasq upstream server'));
		o.value('redirect', _('Redirect 53 port to AdGuardHome'));
		o.value('exchange', _('Use port 53 replace dnsmasq'));

		o = s.option(form.Value, 'binpath', _('Bin Path'));
		o.rmempty = false;
		o = s.option(form.ListValue, 'upxflag', _('use upx to compress bin after download'));
		o.value('', _('none'));
		o.value('-1', _('compress faster'));
		o.value('-9', _('compress better'));
		o.value('--best', _('compress best(can be slow for big files)'));
		o.value('--brute', _('try all available compression methods & filters [slow]'));
		o.value('--ultra-brute', _('try even more compression variants [very slow]'));

		o = s.option(form.Value, 'configpath', _('Config Path'));
		o.rmempty = false;
		o = s.option(form.Value, 'workdir', _('Work dir'));
		o.rmempty = false;
		o = s.option(form.Value, 'logfile', _('Runtime log file'));
		o = s.option(form.Flag, 'verbose', _('Verbose log'));

		//o = s.option(form.Value, 'gfwupstream', _('Gfwlist upstream dns server'));
		//o.placeholder = 'tcp://208.67.220.220:5353';

		o = s.option(form.DummyValue, '_passmgr', _('Change browser management password'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div style="display:grid;gap:6px;max-width:680px">'
				+ '<input id="adh-plainpass" type="password" class="cbi-input-password" placeholder="' + _('Plain password') + '"/>'
				+ '<input id="adh-hashpass" type="text" class="cbi-input-text" readonly="readonly" placeholder="' + _('Bcrypt hash output') + '"/>'
				+ '<div style="display:flex;gap:8px">'
				+ '<button id="adh-calc-bcrypt" class="btn cbi-button cbi-button-action" type="button">' + _('Calculate Bcrypt hash') + '</button>'
				+ '<button id="adh-save-bcrypt" class="btn cbi-button cbi-button-apply" type="button">' + _('Save password hash') + '</button>'
				+ '</div></div>';
		};
		o.description = _('Use plain password, calculate Bcrypt hash, then save.');

		o = s.option(form.MultiValue, 'upprotect', _('Keep files when system upgrade'));
		o.widget = 'checkbox';
		o.value('$binpath', _('core bin'));
		o.value('$configpath', _('config file'));
		o.value('$logfile', _('log file'));
		o.value('$workdir/data/sessions.db', _('sessions.db'));
		o.value('$workdir/data/stats.db', _('stats.db'));
		o.value('$workdir/data/querylog.json', _('querylog.json'));
		o.value('$workdir/data/filters', _('filters'));

		o = s.option(form.Flag, 'waitonboot', _('On boot when network ok restart'));
		o = s.option(form.MultiValue, 'backupfile', _('Backup workdir files when shutdown'));
		o.widget = 'checkbox';
		o.value('filters');
		o.value('stats.db');
		o.value('querylog.json');
		o.value('sessions.db');

		o = s.option(form.Value, 'backupwdpath', _('Backup workdir path'));
		o.placeholder = '/usr/bin/AdGuardHome';

		o = s.option(form.MultiValue, 'crontab', _('Crontab task'));
		o.widget = 'checkbox';
		o.value('autoupdate', _('Auto update core'));
		o.value('cutquerylog', _('Auto tail querylog'));
		o.value('cutruntimelog', _('Auto tail runtime log'));
		o.value('autohost', _('Auto update ipv6 hosts and restart adh'));
		//o.value('autogfw', _('Auto update gfwlist and restart adh'));

		o = s.option(form.TextValue, 'downloadlinks', _('Download links for update'));
		o.rows = 4;
		o.cfgvalue = function() { return fs.read_direct('/usr/share/AdGuardHome/links.txt', 'text')
			.then(function(txt) { return txt || ''; }).catch(function() { return ''; }); };
		o.write = function(_, val) { return fs.write('/usr/share/AdGuardHome/links.txt', (val || '').replace(/\r\n/g, '\n')); };

		//var s2 = m.section(form.NamedSection, 'AdGuardHome', 'AdGuardHome', _('Actions'));
		//s2.anonymous = true;
		//var b = s2.option(form.Button, '_gfwadd', _('Add gfwlist'));
		//b.onclick = ui.createHandlerFn(this, function() { return fs.exec('/bin/sh', [ '/usr/share/AdGuardHome/gfw2adg.sh' ]); });
		//b = s2.option(form.Button, '_gfwdel', _('Del gfwlist'));
		//b.onclick = ui.createHandlerFn(this, function() { return fs.exec('/bin/sh', [ '/usr/share/AdGuardHome/gfw2adg.sh', 'del' ]); });

		return m.render().then(L.bind(function(node) {
			var calcBtn = node.querySelector('#adh-calc-bcrypt');
			var saveBtn = node.querySelector('#adh-save-bcrypt');
			var openWebBtn = node.querySelector('.cbi-value[data-name="_open_web"] button');
			var updateBtn = node.querySelector('#adh-update-btn');
			var forceBtn = node.querySelector('#adh-force-update-btn');
			var updateReverseTag = node.querySelector('#adh-update-reverse');
			var plainInput = node.querySelector('#adh-plainpass');
			var hashInput = node.querySelector('#adh-hashpass');

			if (openWebBtn)
				openWebBtn.disabled = !status.running;

			var startUpdate = function(force) {
				updatePolling = true;
				var box = document.getElementById('adh-update-log-wrap');
				var ta = document.getElementById('adh-update-log');
				if (box) box.style.display = 'block';
				if (ta) ta.value = _('Checking update log...') + '\n';
				return force ? callHelper('doupdate', [ 'force' ]) : callHelper('doupdate');
			};

			if (updateBtn)
				updateBtn.addEventListener('click', function() { startUpdate(false); });
			if (forceBtn)
				forceBtn.addEventListener('click', function() { startUpdate(true); });

			if (calcBtn && plainInput && hashInput) {
				calcBtn.addEventListener('click', function() {
					if (!plainInput.value) {
						ui.addNotification(null, E('p', _('Plain password is empty.')), 'warning');
						return;
					}
					loadBcrypt().then(function() {
						hashInput.value = window.TwinBcrypt.hashSync(plainInput.value);
						ui.addNotification(null, E('p', _('Bcrypt hash generated.')));
					}).catch(function() {
						ui.addNotification(null, E('p', _('Failed to load twin-bcrypt.min.js')), 'danger');
					});
				});
			}

			if (saveBtn && hashInput) {
				saveBtn.addEventListener('click', function() {
					if (!hashInput.value) {
						ui.addNotification(null, E('p', _('Please calculate hash first.')), 'warning');
						return;
					}
					callHelper('set_hashpass', [ hashInput.value ]).then(function() {
						ui.addNotification(null, E('p', _('Password hash saved.')));
						plainInput.value = '';
					}).catch(function(err) {
						ui.addNotification(null, E('p', err.message || _('Save failed')), 'danger');
					});
				});
			}

			poll.add(L.bind(function() {
				return callHelper('status').then(function(res) {
					var st = parseJSON(res.stdout || '{}', {});
					var el = node.querySelector('.cbi-value[data-name="_status"] .cbi-value-field');
					if (el)
						el.innerHTML = 'AdGuardHome '
							+ (st.running ? '<span style="color:var(--success-color-high,#2e7d32)"><strong>' + _('RUNNING') + '</strong></span>' : '<span style="color:var(--error-color-high,#d32f2f)"><strong>' + _('NOT RUNNING') + '</strong></span>')
							+ ' '
							+ (st.redirect ? '<span style="color:var(--success-color-high,#2e7d32)"><strong>' + _('Redirected') + '</strong></span>' : '<span style="color:var(--error-color-high,#d32f2f)"><strong>' + _('Not redirect') + '</strong></span>')
							+ ' | ' + _('Redirect mode') + ': ' + String.format('%h', redirectLabel(redirectMode));
					if (openWebBtn)
						openWebBtn.disabled = !st.running;
				});
			}, this), 3);

			poll.add(function() {
				if (!updatePolling)
					return Promise.resolve();
				var ta = document.getElementById('adh-update-log');
				if (!ta)
					return Promise.resolve();
				return callHelper('check_update').then(function(res) {
					var out = res.stdout || '';
					var finished = out.indexOf('\u0000') >= 0;
						if (finished)
							out = out.replace(/\u0000/g, '');
						if (out) {
							if (updateReverseTag && updateReverseTag.checked)
								ta.value = out + ta.value;
							else
								ta.value += out;
						}
						if (finished)
							updatePolling = false;
					});
			}, 2);

			return node;
		}, this));
	},

	handleSaveApply: function(ev, mode) {
		return this.super('handleSaveApply', [ ev, mode ]).then(function() {
			return fs.exec('/etc/init.d/AdGuardHome', [ 'reload' ]);
		});
	}
});
