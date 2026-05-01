#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
checkmd5(){
local nowmd5=$(md5sum /tmp/adguard.list 2>/dev/null)
nowmd5=${nowmd5%% *}
local lastmd5=$(uci get AdGuardHome.AdGuardHome.gfwlistmd5 2>/dev/null)
if [ "$nowmd5" != "$lastmd5" ]; then
	uci set AdGuardHome.AdGuardHome.gfwlistmd5="$nowmd5"
	uci commit AdGuardHome
	[ "$1" == "noreload" ] || /etc/init.d/AdGuardHome reload
fi
}
action="$1"
override_upstream="$2"
configpath=$(uci get AdGuardHome.AdGuardHome.configpath 2>/dev/null)
[ -z "$configpath" ] && configpath="/etc/AdGuardHome.yaml"

if [ "$action" = "del" ]; then
	[ -f "$configpath" ] && sed -i '/programaddstart/,/programaddend/d' "$configpath" && checkmd5 "$2"
	exit 0
fi

ensure_config() {
	[ -f "$configpath" ] && return 0
	/usr/libexec/AdGuardHome/luci-helper.sh manual_template > "$configpath" 2>/dev/null
	[ -f "$configpath" ] && return 0
	cp -f /usr/share/AdGuardHome/AdGuardHome_template.yaml "$configpath" 2>/dev/null
	[ -f "$configpath" ] || return 1
	return 0
}
gfwupstream=$(uci get AdGuardHome.AdGuardHome.gfwupstream 2>/dev/null)
if [ "$action" = "add" ] && [ -n "$override_upstream" ]; then
	gfwupstream="$override_upstream"
fi
if [ -z "$gfwupstream" ]; then
gfwupstream="tcp://208.67.220.220:5353"
fi
if ! ensure_config; then
	echo "please make a config first"
	exit 1
fi
decode_base64_file() {
	if command -v base64 >/dev/null 2>&1; then
		base64 -d "$1" > "$2"
	elif command -v busybox >/dev/null 2>&1 && busybox --list 2>/dev/null | grep -qx 'base64'; then
		busybox base64 -d "$1" > "$2"
	elif command -v openssl >/dev/null 2>&1; then
		openssl enc -d -base64 -in "$1" -out "$2"
	elif command -v lua >/dev/null 2>&1; then
		lua - "$1" "$2" <<'EOF'
local in_path, out_path = arg[1], arg[2]
local f = io.open(in_path, "rb")
if not f then os.exit(1) end
local data = f:read("*a")
f:close()
data = data:gsub("[^A-Za-z0-9%+/=]", "")
local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
data = data:gsub('.', function(x)
  if x == '=' then return '' end
  local r, idx = '', b:find(x, 1, true)
  if not idx then return '' end
  idx = idx - 1
  for i = 6, 1, -1 do
    r = r .. ((idx % 2^i - idx % 2^(i-1) > 0) and '1' or '0')
  end
  return r
end)
local out = data:gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
  if #x ~= 8 then return '' end
  local c = 0
  for i = 1, 8 do
    if x:sub(i,i) == '1' then c = c + 2^(8-i) end
  end
  return string.char(c)
end)
local o = io.open(out_path, "wb")
if not o then os.exit(1) end
o:write(out)
o:close()
EOF
	else
		return 127
	fi
}

download_gfwlist() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt
	elif command -v wget-ssl >/dev/null 2>&1; then
		wget-ssl --no-check-certificate https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt -O-
	elif command -v wget >/dev/null 2>&1; then
		wget --no-check-certificate https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt -O-
	elif command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -qO- https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt
	else
		return 127
	fi
}

download_plain_gfwlist() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/v2ray-rules-dat/release/gfw.txt
	elif command -v wget-ssl >/dev/null 2>&1; then
		wget-ssl https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/v2ray-rules-dat/release/gfw.txt -O-
	elif command -v wget >/dev/null 2>&1; then
		wget --no-check-certificate https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/v2ray-rules-dat/release/gfw.txt -O-
	elif command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -qO- https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/v2ray-rules-dat/release/gfw.txt
	else
		return 127
	fi
}

if ! download_gfwlist > /tmp/gfwlist.b64; then
	echo "download gfwlist failed: need curl/wget-ssl/wget/uclient-fetch"
	rm -f /tmp/gfwlist.b64 /tmp/gfwlist.txt /tmp/adguard.list
	exit 1
fi

if ! decode_base64_file /tmp/gfwlist.b64 /tmp/gfwlist.txt; then
	echo "decode gfwlist failed, trying plain gfw domain list source"
	if ! download_plain_gfwlist > /tmp/gfwlist.txt; then
		echo "decode gfwlist failed: need base64 (or busybox base64) or openssl or lua"
		rm -f /tmp/gfwlist.b64 /tmp/gfwlist.txt /tmp/adguard.list
		exit 1
	fi
fi

if [ ! -s /tmp/gfwlist.txt ]; then
	echo "download/decode gfwlist failed: empty gfwlist"
	rm -f /tmp/gfwlist.b64 /tmp/gfwlist.txt /tmp/adguard.list
	exit 1
fi
cat /tmp/gfwlist.txt | awk -v upst="$gfwupstream" 'BEGIN{getline;}{
s1=substr($0,1,1);
if (s1=="!")
{next;}
if (s1=="@"){
    $0=substr($0,3);
    s1=substr($0,1,1);
    white=1;}
else{
    white=0;
}

if (s1=="|")
    {s2=substr($0,2,1);
    if (s2=="|")
    {
        $0=substr($0,3);
        split($0,d,"/");
        $0=d[1];
    }else{
        split($0,d,"/");
        $0=d[3];
    }}
else{
    split($0,d,"/");
    $0=d[1];
}
star=index($0,"*");
if (star!=0)
{
    $0=substr($0,star+1);
    dot=index($0,".");
    if (dot!=0)
        $0=substr($0,dot+1);
    else
        next;
    s1=substr($0,1,1);
}
if (s1==".")
{fin=substr($0,2);}
else{fin=$0;}
if (index(fin,".")==0) next;
if (index(fin,"%")!=0) next;
if (index(fin,":")!=0) next;
match(fin,"^[0-9\.]+")
if (RSTART==1 && RLENGTH==length(fin)) {print "ipset add gfwlist "fin>"/tmp/doipset.sh";next;}
if (fin=="" || finl==fin) next;
finl=fin;
if (white==0)
    {print("    - '\''[/"fin"/]"upst"'\''");}
else{
    print("    - '\''[/"fin"/]#'\''");}
}END{print("    - '\''[/programaddend/]#'\''")}' > /tmp/adguard.list
grep programaddstart "$configpath"
if [ "$?" == "0" ]; then
	sed -i '/programaddstart/,/programaddend/c\    - '\''\[\/programaddstart\/\]#'\''' "$configpath"
	sed -i '/programaddstart/'r/tmp/adguard.list "$configpath"
else
	sed -i '1i\    - '\''[/programaddstart/]#'\''' /tmp/adguard.list
	sed -i '/upstream_dns:/'r/tmp/adguard.list "$configpath"
fi
checkmd5 "$2"
rm -f /tmp/gfwlist.b64 /tmp/gfwlist.txt /tmp/adguard.list