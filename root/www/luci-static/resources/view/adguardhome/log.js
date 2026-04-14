'use strict';
'require view';
'require fs';
'require ui';
'require dom';

var logPath = '/tmp/AdGuardHome.log'; 

return view.extend({
    load: function() {
        
        return fs.read_direct(logPath).catch(function(err) {
            return '';
        });
    },

    render: function(logData) {
        var m = E('div', { class: 'cbi-map' });

        var controlDiv = E('div', { class: 'cbi-value', style: 'margin-bottom: 10px;' }, [
            E('label', { class: 'cbi-value-title', style: 'display:inline-block; width:auto; margin-right:20px;' }, [
                E('input', { type: 'checkbox', id: 'cb_reverse', checked: 'checked' }),
                ' reverse'
            ]),
            E('label', { class: 'cbi-value-title', style: 'display:inline-block; width:auto;' }, [
                E('input', { type: 'checkbox', id: 'cb_localtime', checked: 'checked' }),
                ' localtime'
            ])
        ]);

        var logTextarea = E('textarea', {
            id: 'adg_log_content',
            class: 'cbi-input-textarea',
            style: 'width: 100%; height: 500px; resize: none; font-family: monospace; background-color: #2e2e2e; color: #a9b7c6; padding: 10px;',
            readonly: 'readonly'
        });

        var buttonDiv = E('div', { class: 'cbi-page-actions', style: 'text-align: left; margin-top: 10px;' }, [
            E('button', {
                class: 'btn cbi-button cbi-button-reset',
                click: ui.createHandlerFn(this, 'handleDeleteLog', logTextarea)
            }, 'dellog'),
            ' ',
            E('button', {
                class: 'btn cbi-button cbi-button-action',
                click: ui.createHandlerFn(this, 'handleDownloadLog')
            }, 'download log')
        ]);

        m.appendChild(controlDiv);
        m.appendChild(logTextarea);
        m.appendChild(buttonDiv);

        var cbReverse = m.querySelector('#cb_reverse');
        var cbLocal = m.querySelector('#cb_localtime');
        
        var updateLogView = function() {
            var lines = logData.trim().split('\n');
            if (!lines[0]) lines = []; 
            if (cbReverse.checked) {
                lines.reverse();
            }

            if (cbLocal.checked) {
                lines = lines.map(function(line) {
                    return line.replace(/^(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2})\.\d+/, function(match, p1) {
                        var d = new Date(p1.replace(/\//g, '-') + 'Z'); 
                        return isNaN(d) ? match : d.toLocaleString();
                    });
                });
            }

            logTextarea.value = lines.join('\n');
        };

        cbReverse.addEventListener('change', updateLogView);
        cbLocal.addEventListener('change', updateLogView);

        updateLogView();

        return m;
    },

    handleDeleteLog: function(textarea, ev) {
        if (confirm('Are you sure you want to delete the log?？')) {
            fs.write(logPath, '').then(function() {
                textarea.value = '';
                ui.addNotification(null, E('p', 'The log has been cleared'));
            }).catch(function(e) {
                ui.addNotification(null, E('p', 'Deletion failed: ' + e.message), 'error');
            });
        }
    },

    handleDownloadLog: function(ev) {
        var form = E('form', {
            method: 'get',
            action: logPath,
            target: '_blank'
        });
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    }
});
