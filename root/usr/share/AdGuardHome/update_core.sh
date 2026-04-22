#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
binpath=$(uci get AdGuardHome.AdGuardHome.binpath)
if [ -z "$binpath" ]; then
uci set AdGuardHome.AdGuardHome.binpath="/tmp/AdGuardHome/AdGuardHome"
binpath="/tmp/AdGuardHome/AdGuardHome"
fi
mkdir -p ${binpath%/*}
upxflag=$(uci get AdGuardHome.AdGuardHome.upxflag 2>/dev/null)

check_if_already_running(){
	running_tasks="$(ps |grep "AdGuardHome" |grep "update_core" |grep -v "grep" |awk '{print $1}' |wc -l)"
	[ "${running_tasks}" -gt "2" ] && echo -e "\nA task is already running."  && EXIT 2
}

detect_pkg_mgr() {
	if command -v apk >/dev/null 2>&1; then
		PKG_MGR="apk"
	else
		PKG_MGR="opkg"
	fi
}

pkg_update() {
	[ "$PKG_MGR" = "apk" ] && apk update || opkg update
}

pkg_install() {
	[ "$PKG_MGR" = "apk" ] && apk add "$@" || opkg install "$@"
}

pkg_remove() {
	[ "$PKG_MGR" = "apk" ] && apk del "$@" || opkg remove "$@" --force-depends
}

pkg_has() {
	if [ "$PKG_MGR" = "apk" ]; then
		apk list --installed 2>/dev/null | grep -q "^$1"
	else
		opkg list-installed 2>/dev/null | grep -q "^$1 "
	fi
}

detect_arch() {
	if [ "$PKG_MGR" = "apk" ]; then
		Archt="$(apk --print-arch 2>/dev/null)"
	else
		Archt="$(opkg info kernel 2>/dev/null | grep Architecture | awk -F \"[ _]\" '{print($2)}')"
	fi
	[ -z "$Archt" ] && Archt="$(uname -m)"
	Archt="${Archt%%_*}"
}

check_wgetcurl(){
	which curl && downloader="curl -fL -k --retry 2 --connect-timeout 20 -o" && return
	which wget-ssl && downloader="wget-ssl -t 2 -T 20 -O" && return
	[ -z "$1" ] && pkg_update || (echo error package update && EXIT 1)
	[ -z "$1" ] && (pkg_remove wget wget-nossl >/dev/null 2>&1 ; pkg_install wget ; check_wgetcurl 1 ;return)
	[ "$1" = "1" ] && (pkg_install curl ; check_wgetcurl 2 ; return)
	echo error curl and wget && EXIT 1
}
check_latest_version(){
	check_wgetcurl
	latest_ver="$($downloader - https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest 2>/dev/null|grep -E 'tag_name' |grep -E 'v[0-9.]+' -o 2>/dev/null)"
	if [ -z "${latest_ver}" ]; then
		echo -e "\nFailed to check latest version, please try again later."  && EXIT 1
	fi
	now_ver="$($binpath -c /dev/null --check-config 2>&1| grep -m 1 -E 'v[0-9.]+' -o)"
	[ -z "$now_ver" ] && now_ver="not installed"
	if [ "${latest_ver}"x != "${now_ver}"x ] || [ "$1" == "force" ]; then
		echo -e "Local version: ${now_ver}, cloud version: ${latest_ver}." 
		doupdate_core
	else
			echo -e "\nLocal version: ${now_ver}, cloud version: ${latest_ver}." 
			echo -e "You're already using the latest version." 
			if [ ! -z "$upxflag" ]; then
				filesize=$(ls -l $binpath | awk '{ print $5 }')
				if [ $filesize -gt 8000000 ]; then
					echo -e "start upx may take a long time"
					doupx
					mkdir -p "/tmp/AdGuardHomeupdate/AdGuardHome" >/dev/null 2>&1
					rm -fr /tmp/AdGuardHomeupdate/AdGuardHome/${binpath##*/}
					/tmp/upx-${upx_latest_ver}-${Arch}_linux/upx $upxflag $binpath -o /tmp/AdGuardHomeupdate/AdGuardHome/${binpath##*/}
					rm -rf /tmp/upx-${upx_latest_ver}-${Arch}_linux
					/etc/init.d/AdGuardHome stop
					[ -f "$binpath" ] && rm -f "$binpath"
					mv -f /tmp/AdGuardHomeupdate/AdGuardHome/${binpath##*/} $binpath
					/etc/init.d/AdGuardHome start
					echo -e "finished"
				fi
			fi
			EXIT 0
	fi
}

download_release_checksums() {
	local checksum_file="/tmp/AdGuardHomeupdate/AdGuardHome_checksums.txt"
	local base_url="https://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}"
	local checksum_url

	[ -s "$checksum_file" ] && return 0

	checksum_url="$($downloader - https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/tags/${latest_ver} 2>/dev/null \
		| sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*checksums\.txt\)".*/\1/p' \
		| head -n 1)"

	if [ -n "$checksum_url" ]; then
		$downloader "$checksum_file" "$checksum_url" >/dev/null 2>&1 || return 1
	else
		$downloader "$checksum_file" "${base_url}/checksums.txt" >/dev/null 2>&1 || \
		$downloader "$checksum_file" "${base_url}/sha256sums.txt" >/dev/null 2>&1 || \
		$downloader "$checksum_file" "${base_url}/SHA256SUMS" >/dev/null 2>&1 || return 1
	fi

	grep -Eq '^[A-Fa-f0-9]{64}[[:space:]]+\*?[^[:space:]]+$' "$checksum_file"
}

verify_download_sha256() {
	local filepath="$1"
	local filename="$2"
	local checksum_file="/tmp/AdGuardHomeupdate/AdGuardHome_checksums.txt"
	local checksum_line

	command -v sha256sum >/dev/null 2>&1 || {
		echo "sha256sum is missing, skip update for safety."
		EXIT 1
	}

	download_release_checksums || {
		echo "Failed to download release SHA256 checksums."
		EXIT 1
	}

	checksum_line="$(awk -v fname="$filename" '
		{
			sum=$1;
			name=$2;
			sub(/^\*/, "", name);
			sub(/^\.\//, "", name);
			if (name == fname && sum ~ /^[A-Fa-f0-9]{64}$/) {
				print sum "  " fname;
				exit
			}
		}
	' "$checksum_file")"
	[ -z "$checksum_line" ] && {
		echo "No SHA256 entry found for ${filename}."
		EXIT 1
	}

	echo "${checksum_line%  $filename}  $filepath" | sha256sum -c - >/dev/null 2>&1 || {
		echo "SHA256 verification failed for ${filename}."
		EXIT 1
	}
	echo "SHA256 verified: ${filename}."
}

doupx(){
	detect_arch
	case $Archt in
	"i386")
	Arch="i386"
	;;
	"i686")
	Arch="i386"
	echo -e "i686 use $Arch may have bug" 
	;;
	"x86"|"x86_64"|"amd64")
	Arch="amd64"
	;;
	"mipsel")
	Arch="mipsel"
	;;
	"mips64el")
	Arch="mips64el"
	Arch="mipsel"
	echo -e "mips64el use $Arch may have bug" 
	;;
	"mips")
	Arch="mips"
	;;
	"mips64")
	Arch="mips64"
	Arch="mips"
	echo -e "mips64 use $Arch may have bug" 
	;;
	"arm"|"armv5"|"armv6"|"armv7")
	Arch="arm"
	;;
	"armeb")
	Arch="armeb"
	;;
	"aarch64"|"arm64")
	Arch="arm64"
	;;
	"powerpc")
	Arch="powerpc"
	;;
	"powerpc64")
	Arch="powerpc64"
	;;
	*)
	echo -e "error not support $Archt if you can use offical release please issue a bug" 
	EXIT 1
	;;
	esac
	upx_latest_ver="$($downloader - https://api.github.com/repos/upx/upx/releases/latest 2>/dev/null|grep -E 'tag_name' |grep -E '[0-9.]+' -o 2>/dev/null)"
	$downloader /tmp/upx-${upx_latest_ver}-${Arch}_linux.tar.xz "https://github.com/upx/upx/releases/download/v${upx_latest_ver}/upx-${upx_latest_ver}-${Arch}_linux.tar.xz" 2>&1
	#tar xvJf
	which xz || (pkg_has xz || pkg_update && pkg_install xz) || (echo "xz download fail" && EXIT 1)
	mkdir -p /tmp/upx-${upx_latest_ver}-${Arch}_linux
	xz -d -c /tmp/upx-${upx_latest_ver}-${Arch}_linux.tar.xz| tar -x -C "/tmp" >/dev/null 2>&1
	if [ ! -e "/tmp/upx-${upx_latest_ver}-${Arch}_linux/upx" ]; then
		echo -e "Failed to download upx." 
		EXIT 1
	fi
	rm /tmp/upx-${upx_latest_ver}-${Arch}_linux.tar.xz
}
doupdate_core(){
	echo -e "Updating core..." 
	mkdir -p "/tmp/AdGuardHomeupdate"
	rm -rf /tmp/AdGuardHomeupdate/* >/dev/null 2>&1
	detect_arch
	case $Archt in
	"i386")
	Arch="386"
	;;
	"i686")
	Arch="386"
	;;
	"x86"|"x86_64"|"amd64")
	Arch="amd64"
	;;
	"mipsel")
	Arch="mipsle"
	;;
	"mips64el")
	Arch="mips64le"
	Arch="mipsle"
	echo -e "mips64el use $Arch may have bug" 
	;;
	"mips")
	Arch="mips"
	;;
	"mips64")
	Arch="mips64"
	Arch="mips"
	echo -e "mips64 use $Arch may have bug" 
	;;
	"arm"|"armv5"|"armv6"|"armv7")
	Arch="arm"
	;;
	"aarch64"|"arm64")
	Arch="arm64"
	;;
	"powerpc")
	Arch="ppc"
	echo -e "error not support $Archt" 
	EXIT 1
	;;
	"powerpc64")
	Arch="ppc64"
	echo -e "error not support $Archt" 
	EXIT 1
	;;
	*)
	echo -e "error not support $Archt if you can use offical release please issue a bug" 
	EXIT 1
	;;
	esac
	echo -e "start download" 
	grep -v "^#" /usr/share/AdGuardHome/links.txt >/tmp/run/AdHlinks.txt
	while read link
	do
		eval link="$link"
		$downloader /tmp/AdGuardHomeupdate/${link##*/} "$link" 2>&1
		if [ "$?" != "0" ]; then
			echo "download failed try another download"
			rm -f /tmp/AdGuardHomeupdate/${link##*/}
		else
			local success="1"
			break
		fi 
	done < "/tmp/run/AdHlinks.txt"
	rm /tmp/run/AdHlinks.txt
	[ -z "$success" ] && echo "no download success" && EXIT 1
	verify_download_sha256 "/tmp/AdGuardHomeupdate/${link##*/}" "${link##*/}"
	if [ "${link##*.}" == "gz" ]; then
		tar -zxf "/tmp/AdGuardHomeupdate/${link##*/}" -C "/tmp/AdGuardHomeupdate/"
		if [ ! -e "/tmp/AdGuardHomeupdate/AdGuardHome" ]; then
			echo -e "Failed to download core." 
			rm -rf "/tmp/AdGuardHomeupdate" >/dev/null 2>&1
			EXIT 1
		fi
		downloadbin="/tmp/AdGuardHomeupdate/AdGuardHome/AdGuardHome"
	else
		downloadbin="/tmp/AdGuardHomeupdate/${link##*/}"
	fi
	chmod 755 $downloadbin
	echo -e "download success start copy" 
	if [ -n "$upxflag" ]; then
		echo -e "start upx may take a long time" 
		doupx
		/tmp/upx-${upx_latest_ver}-${Arch}_linux/upx $upxflag $downloadbin
		rm -rf /tmp/upx-${upx_latest_ver}-${Arch}_linux
	fi
	echo -e "start copy" 
	/etc/init.d/AdGuardHome stop
	[ -f "$binpath" ] && rm -f "$binpath"
	mv -f "$downloadbin" "$binpath"
	if [ "$?" == "1" ]; then
		echo "mv failed maybe not enough space please use upx or change bin to /tmp/AdGuardHome" 
		EXIT 1
	fi
	/etc/init.d/AdGuardHome start
	rm -rf "/tmp/AdGuardHomeupdate" >/dev/null 2>&1
	echo -e "Succeeded in updating core." 
	echo -e "Local version: ${latest_ver}, cloud version: ${latest_ver}.\n"
	EXIT 0
}
EXIT(){
	rm /var/run/update_core 2>/dev/null
	[ "$1" != "0" ] && touch /var/run/update_core_error
	exit $1
}
main(){
	detect_pkg_mgr
	check_if_already_running
	check_latest_version $1
}
	trap "EXIT 1" SIGTERM SIGINT
	touch /var/run/update_core
	rm /var/run/update_core_error 2>/dev/null
	main $1
