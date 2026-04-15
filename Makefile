# Copyright (C) 2018-2026 Lienol 
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-adguardhome
LUCI_TITLE:=LuCI app for AdGuardHome
LUCI_DEPENDS:=+luci-base +curl
LUCI_PKGARCH:=all

PKG_VERSION:=1.8
PKG_RELEASE:=11

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-adguardhome/conffiles
/usr/share/AdGuardHome/links.txt
/etc/config/AdGuardHome
endef

define Package/luci-app-adguardhome/postinst
#!/bin/sh

    chmod 755 /etc/init.d/AdGuardHome >/dev/null 2>&1
	chmod 755 /usr/share/AdGuardHome/*.sh >/dev/null 2>&1
    chmod 755 /usr/libexec/rpcd/luci.adguardhome >/dev/null 2>&1
    
	/etc/init.d/AdGuardHome enable >/dev/null 2>&1
	enable=$$(uci get AdGuardHome.AdGuardHome.enabled 2>/dev/null)
	if [ "$$enable" = "1" ]; then
	    /etc/init.d/AdGuardHome reload
	fi
	rm -f /tmp/luci-indexcache
	rm -f /tmp/luci-modulecache/*
	exit 0
endef

define Package/luci-app-adguardhome/prerm
#!/bin/sh
	if [ -z "$${IPKG_INSTROOT}" ]; then
	    /etc/init.d/AdGuardHome disable
	    /etc/init.d/AdGuardHome stop
	    uci -q batch <<-EOF >/dev/null 2>&1
	        delete ucitrack.@AdGuardHome[-1]
	        commit ucitrack
	    EOF
	fi
	exit 0
endef

# Note: After using luci.mk, there is no need to call it again $(eval $(call BuildPackage,...))
