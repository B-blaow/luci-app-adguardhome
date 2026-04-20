#!/bin/sh

ACTION="$1"
shift

json_status() {
	binpath="$(uci -q get AdGuardHome.AdGuardHome.binpath)"
	[ -z "$binpath" ] && binpath="/usr/bin/AdGuardHome/AdGuardHome"
	running=0
	redirect=0
	pgrep "$binpath" >/dev/null 2>&1 && running=1
	[ "$(cat /var/run/AdGredir 2>/dev/null)" = "1" ] && redirect=1
	printf '{"running":%s,"redirect":%s}\n' "$running" "$redirect"
}

current_core_version() {
	binpath="$(uci -q get AdGuardHome.AdGuardHome.binpath)"
	[ -z "$binpath" ] && binpath="/usr/bin/AdGuardHome/AdGuardHome"
	if [ ! -x "$binpath" ]; then
		echo "no core"
		return
	fi
	"$binpath" -c /dev/null --check-config 2>&1 | grep -m 1 -E 'v[0-9.]+' -o
}

build_template() {
	d=""
	while IFS= read -r line; do
		b=$(echo "$line" | sed -n 's/^[^#]*nameserver[[:space:]]\+\([^[:space:]]\+\)$/\1/p')
		[ -n "$b" ] && d="$d  - $b\n"
	done < /tmp/resolv.conf.auto
	awk -v repl="$d" '{
		if ($0 == "#bootstrap_dns" || $0 == "#upstream_dns") {
			printf "%s", repl
		} else {
			print $0
		}
	}' /usr/share/AdGuardHome/AdGuardHome_template.yaml 2>/dev/null
}

case "$ACTION" in
	status)
		json_status
		;;
	core_version)
		current_core_version
		;;
	doupdate)
		echo 0 > /var/run/luciupdatelogpos
		arg=""
		[ "$1" = "force" ] && arg="force"
		if [ -e /var/run/update_core ] && [ "$arg" = "force" ]; then
			kill "$(pgrep -f /usr/share/AdGuardHome/update_core.sh)" >/dev/null 2>&1
		fi
		if [ ! -e /var/run/update_core ] || [ "$arg" = "force" ]; then
			sh /usr/share/AdGuardHome/update_core.sh "$arg" >/tmp/AdGuardHome_update.log 2>&1 &
		fi
		;;
	check_update)
		fdp="$(cat /var/run/luciupdatelogpos 2>/dev/null)"
		[ -z "$fdp" ] && fdp=0
		tail -c +$((fdp + 1)) /tmp/AdGuardHome_update.log 2>/dev/null
		wc -c /tmp/AdGuardHome_update.log 2>/dev/null | awk '{print $1}' >/var/run/luciupdatelogpos
		[ -e /var/run/update_core ] || printf '\0'
		;;
	get_log)
		logfile="$(uci -q get AdGuardHome.AdGuardHome.logfile)"
		[ -z "$logfile" ] && exit 0
		if [ "$logfile" = "syslog" ]; then
			[ -e /var/run/AdGuardHomesyslog ] || (/usr/share/AdGuardHome/getsyslog.sh >/dev/null 2>&1 &)
			logfile="/tmp/AdGuardHometmp.log"
			echo 1 >/var/run/AdGuardHomesyslog
		fi
		[ -f "$logfile" ] || exit 0
		fdp="$(cat /var/run/luciruntimelogpos 2>/dev/null)"
		[ -z "$fdp" ] && fdp=0
		tail -c +$((fdp + 1)) "$logfile" 2>/dev/null
		wc -c "$logfile" 2>/dev/null | awk '{print $1}' >/var/run/luciruntimelogpos
		;;
	del_log)
		logfile="$(uci -q get AdGuardHome.AdGuardHome.logfile)"
		[ -n "$logfile" ] && : > "$logfile"
		;;
	manual_template)
		build_template
		;;
	manual_read)
		configpath="$(uci -q get AdGuardHome.AdGuardHome.configpath)"
		[ -z "$configpath" ] && configpath="/etc/AdGuardHome.yaml"
		if [ -f /tmp/AdGuardHometmpconfig.yaml ]; then
			cat /tmp/AdGuardHometmpconfig.yaml
		elif [ -f "$configpath" ]; then
			cat "$configpath"
		else
			build_template
		fi
		;;
	manual_save)
		configpath="$(uci -q get AdGuardHome.AdGuardHome.configpath)"
		binpath="$(uci -q get AdGuardHome.AdGuardHome.binpath)"
		[ -z "$configpath" ] && configpath="/etc/AdGuardHome.yaml"
		[ -z "$binpath" ] && binpath="/usr/bin/AdGuardHome/AdGuardHome"
		tmpfile="/tmp/AdGuardHometmpconfig.yaml"
		printf '%s' "$1" | sed 's/\r$//' > "$tmpfile"
		if [ -x "$binpath" ]; then
			if ! "$binpath" -c "$tmpfile" --check-config >/tmp/AdGuardHometest.log 2>&1; then
				echo "Config check failed"
				exit 1
			fi
		fi
		mv "$tmpfile" "$configpath"
		echo "Saved"
		;;
	set_hashpass)
		[ -n "$1" ] || {
			echo "empty hash" >&2
			exit 1
		}
		uci set AdGuardHome.AdGuardHome.hashpass="$1"
		uci commit AdGuardHome
		/etc/init.d/AdGuardHome reload >/dev/null 2>&1
		echo "Saved"
		;;
	reload_tmp)
		rm -f /tmp/AdGuardHometmpconfig.yaml
		;;
	*)
		echo "unsupported action" >&2
		exit 1
		;;
esac
