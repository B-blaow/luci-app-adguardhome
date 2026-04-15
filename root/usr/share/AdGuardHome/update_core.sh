#!/bin/sh

PATH="/usr/sbin:/usr/bin:/sbin:/bin"
LOG_FILE="/tmp/AdH_update.log"
LOCK_FILE="/tmp/adh_update.lock"

exec > "$LOG_FILE" 2>&1

binpath=$(uci -q get AdGuardHome.AdGuardHome.binpath || echo "/usr/bin/AdGuardHome/AdGuardHome")
upxflag=$(uci -q get AdGuardHome.AdGuardHome.upxflag || echo "none")

EXIT() {
    rm -f "$LOCK_FILE"
    rm -f /var/run/update_core 2>/dev/null
    if [ "$1" != "0" ]; then
        touch /var/run/update_core_error
        echo -e "\n[ERROR] Update failed! (Exit code: $1)"
    fi

    rm -rf "/tmp/AdGuardHomeupdate"
    exit "$1"
}

check_if_already_running() {
    if [ -f "$LOCK_FILE" ]; then
        local old_pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
             echo "Error: Another update task (PID: $old_pid) is already running. Exiting."
             exit 1
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

# 配置下载工具（开启静默模式以防内存溢出）
check_wgetcurl() {
    if command -v curl >/dev/null 2>&1; then
        # -s: 静默模式, -L: 跟随重定向, -S: 显示必要错误
        downloader="curl -L -S --retry 2 --connect-timeout 20 --max-time 300 -o"  
    elif command -v wget-ssl >/dev/null 2>&1; then
        # -q: 静默模式
        downloader="wget-ssl -q -t 2 -T 20 -O"
    else
        downloader="wget --no-check-certificate -q -t 2 -T 20 -O"
    fi
}

get_arch() {
    local sys_arch=$(uname -m)
    case "$sys_arch" in
        x86_64 | amd64) echo "amd64" ;;
        i?86) echo "386" ;;
        aarch64) echo "arm64" ;;
        armv7* | arm*) echo "armv7" ;;
        *) echo "$sys_arch" ;;
    esac
}

# UPX 压缩逻辑（静默执行，防止日志爆表）
doupx() {
    [ -z "$upxflag" ] || [ "$upxflag" = "none" ] && return 0
    
    echo "Starting UPX compression (Level: $upxflag)... Please wait."
    local upx_arch=$(get_arch)
    local upx_latest_ver=$($downloader - https://api.github.com/repos/upx/upx/releases/latest 2>/dev/null | grep -E 'tag_name' | grep -E '[0-9.]+' -o | head -n 1)
    
    [ -z "$upx_latest_ver" ] && { echo "Warning: Failed to fetch UPX, skipping compression."; return 1; }
    
    command -v xz >/dev/null || { echo "Installing xz..." && apk update && apk add xz; }

    cd /tmp || return 1
    rm -rf upx*.tar* upx-*_linux 2>/dev/null
    
    $downloader /tmp/upx.tar.xz "https://github.com/upx/upx/releases/download/v${upx_latest_ver}/upx-${upx_latest_ver}-${upx_arch}_linux.tar.xz"
    xz -d /tmp/upx.tar.xz && tar -xf /tmp/upx.tar
    
    local upx_bin=$(find /tmp/upx-*_linux -type f -name "upx" | head -n 1)
    if [ -n "$upx_bin" ] && [ -x "$upx_bin" ]; then
        # 将 UPX 进度丢弃，防止日志缓冲区满
        "$upx_bin" -$upxflag "$1" >/dev/null 2>&1
        echo "Compression finished."
    fi
    
    rm -rf /tmp/upx*.tar* /tmp/upx-*_linux
    cd - >/dev/null || true
}

doupdate_core() {
    local Arch=$(get_arch)
    echo "Target Architecture: $Arch"
    
    mkdir -p "/tmp/AdGuardHomeupdate"

    local links_file="/usr/share/AdGuardHome/links.txt"
    [ ! -f "$links_file" ] && { echo "Error: links.txt not found."; EXIT 1; }

    local success=""
    while read -r link; do
        [ -z "$link" ] || echo "$link" | grep -q "^#" && continue

        local target_link=$(echo "$link" | sed "s/\${latest_ver}/$latest_ver/g; s/\${Arch}/$Arch/g")
        
        echo "Trying download: $target_link"
        $downloader "/tmp/AdGuardHomeupdate/core.tar.gz" "$target_link"
        
        if [ "$?" -eq 0 ] && [ -s "/tmp/AdGuardHomeupdate/core.tar.gz" ]; then
            echo "Download successful."
            success="1"; break
        fi
    done < "$links_file"
    
    [ -z "$success" ] && { echo "Error: All mirrors failed."; EXIT 1; }
    
    echo "Extracting archive..."
    tar -zxf "/tmp/AdGuardHomeupdate/core.tar.gz" -C "/tmp/AdGuardHomeupdate/"
    local newbin=$(find /tmp/AdGuardHomeupdate -type f -name "AdGuardHome" | head -n 1)
    [ -z "$newbin" ] && { echo "Error: Binary not found in package."; EXIT 1; }
    
    chmod 755 "$newbin"
    doupx "$newbin"
    
    echo "Stopping service and installing..."
    /etc/init.d/AdGuardHome stop nobackup >/dev/null 2>&1

    mkdir -p "${binpath%/*}"
    mv -f "$newbin" "$binpath"
    
    if [ "$?" -eq 0 ]; then
        echo "New core installed successfully to $binpath"
        echo "Restarting AdGuardHome..."
        /etc/init.d/AdGuardHome start >/dev/null 2>&1
        echo -e "\nUpdate Succeeded!"
        EXIT 0
    else
        echo "Error: Failed to move binary."
        EXIT 1
    fi
}

check_latest_version() {
    check_wgetcurl
    echo "Fetching latest version info..."
    latest_ver=$($downloader - https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest 2>/dev/null | grep -E 'tag_name' | grep -E 'v[0-9.]+' -o | head -n 1)
    
    if [ -z "${latest_ver}" ]; then
        echo "Error: GitHub API unreachable."
        EXIT 1
    fi
    
    local now_ver=$("$binpath" --version 2>/dev/null | awk '{print $4}')
    echo "Local version:  ${now_ver:-Not installed}"
    echo "Latest version: $latest_ver"

    if [ "${latest_ver}" != "${now_ver}" ] || [ "$1" == "force" ]; then
        doupdate_core
    else
        echo "Already up to date."
        echo -e "\nUpdate Succeeded!"
        EXIT 0
    fi
}

touch /var/run/update_core
rm -f /var/run/update_core_error 2>/dev/null

trap "EXIT 1" SIGTERM SIGINT
check_if_already_running
check_latest_version "$1"
