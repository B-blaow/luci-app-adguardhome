'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require fs';

var callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

var callGetLinks = rpc.declare({
    object: 'luci.adguardhome',
    method: 'get_links',
    expect: { '': {} }
});

var callSetLinks = rpc.declare({
    object: 'luci.adguardhome',
    method: 'set_links',
    params: ['content'],
    expect: { '': {} }
});

var callUpdateCore = rpc.declare({
    object: 'luci.adguardhome',
    method: 'update_core',
    expect: { '': {} }
});

var callCheckVersion = rpc.declare({
    object: 'luci.adguardhome',
    method: 'check_version',
    expect: { '': {} }
});

return view.extend({

    load: function () {
        return Promise.all([
            uci.load('AdGuardHome'),
            callGetLinks().catch(function (e) {
                console.error('[AdGuardHome] callGetLinks failed:', e);
                return { content: '' };
            })
        ]).then(function (results) {
            var linksResult = results[1] || {};
            var content = '';

            if (typeof linksResult === 'string') {
                content = linksResult;
            } else if (linksResult && linksResult.content !== undefined) {
                content = linksResult.content;
            } else if (linksResult && typeof linksResult === 'object') {
                content = JSON.stringify(linksResult, null, 2);
            }

            return {
                uci: results[0],
                linksData: { content: content }
            };
        });
    },

    render: function (data) {
        var linksData = data.linksData || { content: '' };
        let m, s, o;

        m = new form.Map('AdGuardHome', _('AdGuard Home'),
            _('Free and open source, powerful network-wide ads & trackers blocking DNS server.'));

        s = m.section(form.NamedSection, 'AdGuardHome', 'AdGuardHome');
        s.addremove = false;
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.rmempty = false;

        o = s.option(form.DummyValue, '_status', _('Status'));
        o.rawhtml = true;
        o.cfgvalue = function () {
            return '<div id="status_bar" style="margin-bottom: 10px;"><em>' + _('Collecting data...') + '</em></div>' +
                '<button class="btn cbi-button cbi-button-apply" id="btn_dashboard" disabled>' + _('Open Web Interface') + '</button>';
        };

        o = s.option(form.DummyValue, '_core_ver', _('Core Version'));
        o.rawhtml = true;
        o.cfgvalue = function () {
            return '<div id="core_version_status"><em>' + _('Checking version...') + '</em></div>' +
                '<button class="btn cbi-button cbi-button-apply" id="btn_update_core" style="margin-top:5px">' + _('Update Core') + '</button>' +
                '<p id="current_core_version" style="font-size:12px; color:green; margin-top:5px;">● ' + _('Current Core Version: ') + '...</p>' +
                '<div id="update_log_container" style="display:none; margin-top:10px; width: 100%;"></div>';
        };

        o = s.option(form.Value, 'httpport', _('Browser management port'),
            _('Default username and password: admin, Port:'));
        o.datatype = 'port';
        o.placeholder = '3000';
        o.description = '<span style="background-color:yellow; color:red; font-weight:bold; padding:2px 5px; border-radius:3px;">AdGuardHome Web:3000</span>';

        o = s.option(form.ListValue, 'redirect', _('Redirect'));
        o.value('', _('None'));
        o.value('dnsmasq-upstream', _('Run as dnsmasq upstream server'));
        o.value('redirect', _('Redirect 53 port to AdGuardHome'));
        o.value('exchange', _('Use port 53 replace dnsmasq'));

        o = s.option(form.Value, 'binpath', _('Bin Path'));
        o.placeholder = '/usr/bin/AdGuardHome/AdGuardHome';

        o = s.option(form.Value, 'workdir', _('Work Dir'));
        o.placeholder = '/usr/share/AdGuardHome';

        o = s.option(form.ListValue, 'upxflag', _('Compression executable file with upx after download'));
        o.value('none', _('None'));
        o.value('1', _('Fast compression'));
        o.value('2', _('Better compression'));
        o.value('3', _('Best compression'));
        o.value('4', _('Try all possible [slow]'));
        o.value('5', _('Try more variant [very slow]'));

        o = s.option(form.Value, 'configpath', _('Config Path'));
        o.placeholder = '/etc/AdGuardHome.yaml';

        o = s.option(form.Value, 'logfile', _('Log File'));
        o.placeholder = '/tmp/AdGuardHome.log';

        o = s.option(form.Flag, 'waitonboot', _('Wait Network'));
        o = s.option(form.Flag, 'verbose', _('Verbose Log'));

        o = s.option(form.MultiValue, 'crontab', _('Scheduled Tasks'));
        o.display = 'checkbox';
        o.value('autoupdate', _('Auto Upgrade Core'));
        o.value('cutquerylog', _('Auto Truncate Query Log'));
        o.value('cutruntimelog', _('Auto Truncate Run Log'));
        o.value('autohost', _('Auto Update IPv6 & Restart ADH'));
        o.value('autogfw', _('Auto Update GFW List & Restart ADH'));

        o = s.option(form.MultiValue, 'keep_files', _('Keep files on upgrade'));
        o.display = 'checkbox';
        o.value('bin', _('Core File'));
        o.value('config', _('Config File'));
        o.value('log', _('Log File'));
        o.value('sessions', _('sessions.db'));
        o.value('stats', _('stats.db'));
        o.value('filters', _('Filters'));

        o = s.option(form.TextValue, '_links_editor', _('Mirrors (links.txt)'));
        o.rows = 8;
        o.description = _('One URL per line. The update script will read these URLs to download the core.');
        o.cfgvalue = function () { return linksData.content || ''; };
        o.write = function (section_id, formvalue) { return callSetLinks(formvalue); };
        o.remove = function () { return callSetLinks(''); };

        o = s.option(form.DummyValue, '_extra_ops');
        o.rawhtml = true;
        o.cfgvalue = function () {
            return '<div style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">' +
                '<select class="cbi-input-select" id="extra_select" style="width: auto; min-width: 220px;">' +
                '<option value="">' + _('-- More Options --') + '</option>' +
                '<option value="del_gfw">' + _('Delete GFW List') + '</option>' +
                '<option value="add_gfw">' + _('Add GFW List') + '</option>' +
                '<option value="change_pass">' + _('Change Web Login Password') + '</option>' +
                '</select>' +
                '<button class="btn cbi-button cbi-button-save" id="btn_extra_add">' + _('Add') + '</button>' +
                '</div>';
        };

        return m.render().then(function (mapNode) {

            callServiceList('AdGuardHome').then(function (res) {
                let isRunning = false;
                if (res && res.AdGuardHome && res.AdGuardHome.instances) {
                    for (let i in res.AdGuardHome.instances) {
                        if (res.AdGuardHome.instances[i].running) {
                            isRunning = true;
                            break;
                        }
                    }
                }

                let statusDiv = mapNode.querySelector('#status_bar');
                let btnDash = mapNode.querySelector('#btn_dashboard');

                if (statusDiv) {
                    statusDiv.innerHTML = isRunning ?
                        '<span style="color:green; font-weight:bold; font-size:14px;">' + _('RUNNING') + '</span>' :
                        '<span style="color:red; font-weight:bold; font-size:14px;">' + _('NOT RUNNING') + '</span>';

                    if (btnDash && isRunning) {
                        btnDash.disabled = false;
                        btnDash.classList.add('cbi-button-save');
                        btnDash.addEventListener('click', function (ev) {
                            ev.preventDefault();
                            let port = uci.get('AdGuardHome', 'AdGuardHome', 'httpport') || '3000';
                            window.open(window.location.protocol + '//' + window.location.hostname + ':' + port, '_blank');
                        });
                    }
                }
            });

            let verStatus = mapNode.querySelector('#core_version_status');
            let curVer = mapNode.querySelector('#current_core_version');

            callCheckVersion().then(function (res) {
                if (res && res.version) {
                    curVer.innerHTML = '● ' + _('Current Core Version: ') + res.version;
                    verStatus.innerHTML = '<em>' + (res.new_version ? _('Latest: ') + res.new_version : _('Version checked')) + '</em>';
                }
            });

            let btnUpdate = mapNode.querySelector('#btn_update_core');
            let logContainer = mapNode.querySelector('#update_log_container');

            if (btnUpdate && logContainer) {
                btnUpdate.addEventListener('click', function (ev) {
                    ev.preventDefault();

                    btnUpdate.disabled = true;
                    btnUpdate.textContent = _('Updating...');
                    logContainer.style.display = 'block';
                    logContainer.innerHTML = '<div id="core_log_wrapper"></div>';

                    let logDiv = mapNode.querySelector('#core_log_wrapper');
                    logDiv.textContent = _('Initializing...') + '\n';

                    fs.write('/tmp/AdH_update.log', '').then(function () {
                        return callUpdateCore();
                    }).then(function () {
                        function scrollLog() {
                            fs.read('/tmp/AdH_update.log').then(function (content) {
                                if (content) {
                                    logDiv.textContent = content;
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                }

                                if (content.indexOf('Update Succeeded') !== -1 ||
                                    content.indexOf('Update failed') !== -1) {

                                    btnUpdate.disabled = false;
                                    btnUpdate.textContent = _('Update Core');
                                    btnUpdate.classList.add('cbi-button-save');

                                    setTimeout(function () { location.reload(); }, 2000);
                                } else {
                                    setTimeout(scrollLog, 1000);
                                }
                            });
                        }
                        scrollLog();
                    });
                });
            }

            return mapNode;
        });
    }
});
