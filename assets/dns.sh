#!/usr/bin/env bash

####################################
# DNS Server Installation Script for Debian, CentOS/RHEL, and Arch
# Created by: KeepItTechie
# YouTube Channel: https://youtube.com/@KeepItTechie
# Blog: https://docs.keepittechie.com/
####################################

############################################################
# This script automates the installation and configuration of
# a DNS caching server (dnsmasq), a DNS server (bind9) or a
# recursive/caching DNS resolver (unbound) on Debian,
# CentOS/RHEL, and Arch-based systems. The user is prompted
# to select which server they would like to install.
#
# To build a redundant DNS setup, simply run this script on
# each of your DNS servers (e.g. run the unbound option on two
# machines, then point your clients to both IP addresses).
#
# Author: KeepItTechie
# Version: 2.1
# License: MIT
#
# Usage:
#   1. Save the script to a file, for example, auto-dns.sh.
#   2. Make the script executable:
#      chmod +x auto-dns.sh
#   3. Run the script:
#      sudo ./auto-dns.sh
#
############################################################

# Function to detect the Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
    else
        echo "Unsupported distribution!"
        exit 1
    fi
}

# Basic IPv4 address validation
validate_ipv4() {
    local ip=$1
    local octet
    if [[ ! $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 1
    fi
    IFS='.' read -r -a OCTETS <<< "$ip"
    for octet in "${OCTETS[@]}"; do
        if ((octet > 255)); then
            return 1
        fi
    done
    return 0
}

# Prompt until a valid IPv4 address is entered
prompt_ipv4() {
    local prompt_msg=$1
    local input
    while true; do
        read -rp "$prompt_msg" input
        if validate_ipv4 "$input"; then
            echo "$input"
            return 0
        fi
        echo "Invalid IPv4 address, please try again." >&2
    done
}

# Function to install and configure dnsmasq as DNS caching server
install_dns_caching() {
    case "$DISTRO" in
        ubuntu|debian)
            sudo apt update
            sudo apt install -y dnsmasq
            ;;
        centos|rhel|rocky|alma)
            sudo dnf install -y dnsmasq
            ;;
        arch)
            sudo pacman -Sy --noconfirm dnsmasq
            ;;
        *)
            echo "Unsupported distribution!"
            exit 1
            ;;
    esac

    UPSTREAM_DNS=$(prompt_ipv4 "Enter the upstream DNS server (e.g., 8.8.8.8): ")

    echo "server=$UPSTREAM_DNS" | sudo tee -a /etc/dnsmasq.conf > /dev/null
    sudo systemctl enable dnsmasq
    sudo systemctl restart dnsmasq
}

# Function to install and configure bind9 as DNS server
install_dns_server() {
    case "$DISTRO" in
        ubuntu|debian)
            sudo apt update
            sudo apt install -y bind9 bind9utils bind9-doc
            ;;
        centos|rhel|rocky|alma)
            sudo dnf install -y bind bind-utils
            ;;
        arch)
            sudo pacman -Sy --noconfirm bind
            ;;
        *)
            echo "Unsupported distribution!"
            exit 1
            ;;
    esac

    read -rp "Enter your domain name (e.g., example.com): " DOMAIN_NAME
    DNS_SERVER_IP=$(prompt_ipv4 "Enter the IP address of your DNS server (e.g., 192.168.1.100): ")

    # Derive the reverse zone from the server IP (assumes a /24 network)
    IFS='.' read -r OCT1 OCT2 OCT3 OCT4 <<< "$DNS_SERVER_IP"
    REVERSE_ZONE="$OCT3.$OCT2.$OCT1.in-addr.arpa"
    REVERSE_FILE="db.$OCT1.$OCT2.$OCT3"

    # Configure the named.conf.local file
    cat <<EOF | sudo tee /etc/bind/named.conf.local > /dev/null
zone "$DOMAIN_NAME" {
    type master;
    file "/etc/bind/zones/db.$DOMAIN_NAME";
};

zone "$REVERSE_ZONE" {
    type master;
    file "/etc/bind/zones/$REVERSE_FILE";
};
EOF

    sudo mkdir -p /etc/bind/zones

    # Configure forward zone
    cat <<EOF | sudo tee "/etc/bind/zones/db.$DOMAIN_NAME" > /dev/null
;
; BIND data file for $DOMAIN_NAME
;
\$TTL    604800
@       IN      SOA     ns1.$DOMAIN_NAME. admin.$DOMAIN_NAME. (
                        1         ; Serial
                        604800    ; Refresh
                        86400     ; Retry
                        2419200   ; Expire
                        604800 )  ; Negative Cache TTL
;
@       IN      NS      ns1.$DOMAIN_NAME.
@       IN      A       $DNS_SERVER_IP
ns1     IN      A       $DNS_SERVER_IP
EOF

    # Configure reverse zone
    cat <<EOF | sudo tee "/etc/bind/zones/$REVERSE_FILE" > /dev/null
;
; BIND reverse data file for the $OCT1.$OCT2.$OCT3.0 network
;
\$TTL    604800
@       IN      SOA     ns1.$DOMAIN_NAME. admin.$DOMAIN_NAME. (
                        1         ; Serial
                        604800    ; Refresh
                        86400     ; Retry
                        2419200   ; Expire
                        604800 )  ; Negative Cache TTL
;
@       IN      NS      ns1.$DOMAIN_NAME.
$OCT4   IN      PTR     ns1.$DOMAIN_NAME.
EOF

    sudo systemctl enable named 2>/dev/null || sudo systemctl enable bind9
    sudo systemctl restart named 2>/dev/null || sudo systemctl restart bind9
}

# Function to install and configure unbound as recursive/caching DNS resolver
install_unbound() {
    case "$DISTRO" in
        ubuntu|debian)
            sudo apt update
            sudo apt install -y unbound
            UNBOUND_CONF="/etc/unbound/unbound.conf.d/lan-resolver.conf"
            ;;
        centos|rhel|rocky|alma)
            sudo dnf install -y unbound
            UNBOUND_CONF="/etc/unbound/conf.d/lan-resolver.conf"
            sudo mkdir -p /etc/unbound/conf.d
            ;;
        arch)
            sudo pacman -Sy --noconfirm unbound expat
            UNBOUND_CONF="/etc/unbound/unbound.conf"
            ;;
        *)
            echo "Unsupported distribution!"
            exit 1
            ;;
    esac

    SERVER_IP=$(prompt_ipv4 "Enter the IP address of THIS server (e.g., 192.168.1.10): ")

    read -rp "Enter the network allowed to query this resolver (CIDR, e.g., 192.168.1.0/24): " ALLOWED_NET
    if [[ ! $ALLOWED_NET =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "Invalid CIDR network (expected something like 192.168.1.0/24). Exiting."
        exit 1
    fi

    # Backup an existing configuration file before overwriting it
    if [ -f "$UNBOUND_CONF" ]; then
        sudo cp "$UNBOUND_CONF" "$UNBOUND_CONF.bak.$(date +%Y%m%d%H%M%S)"
    fi

    cat <<EOF | sudo tee "$UNBOUND_CONF" > /dev/null
server:
    # Listen on localhost and on the LAN interface
    interface: 127.0.0.1
    interface: $SERVER_IP
    port: 53
    do-ip4: yes
    do-udp: yes
    do-tcp: yes

    # Access control: only localhost and the LAN may query
    access-control: 127.0.0.0/8 allow
    access-control: $ALLOWED_NET allow
    access-control: 0.0.0.0/0 refuse

    # Privacy and hardening
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    qname-minimisation: yes

    # Cache performance
    prefetch: yes
    cache-min-ttl: 300
    cache-max-ttl: 86400
    num-threads: 2
    msg-cache-size: 64m
    rrset-cache-size: 128m
EOF

    # On Ubuntu/Debian, systemd-resolved's stub listener occupies port 53
    if systemctl is-active --quiet systemd-resolved; then
        echo "Disabling systemd-resolved DNS stub listener (conflicts with unbound on port 53)..."
        sudo mkdir -p /etc/systemd/resolved.conf.d
        cat <<EOF | sudo tee /etc/systemd/resolved.conf.d/disable-stub.conf > /dev/null
[Resolve]
DNS=127.0.0.1
DNSStubListener=no
EOF
        sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
        sudo systemctl restart systemd-resolved
    fi

    # Make sure the DNSSEC trust anchor exists before validating the config
    if [ ! -f /var/lib/unbound/root.key ]; then
        sudo mkdir -p /var/lib/unbound
        if [ -f /usr/share/dns/root.key ]; then
            # Debian/Ubuntu: shipped by the dns-root-data package
            sudo cp /usr/share/dns/root.key /var/lib/unbound/root.key
        elif command -v unbound-anchor > /dev/null; then
            # RHEL/Arch: bootstrap it with unbound-anchor
            sudo unbound-anchor -a /var/lib/unbound/root.key || true
        fi
        sudo chown unbound:unbound /var/lib/unbound/root.key 2>/dev/null || true
    fi

    # Validate the configuration before (re)starting the service
    if ! sudo unbound-checkconf; then
        echo "unbound configuration is invalid, please check $UNBOUND_CONF. Exiting."
        exit 1
    fi

    sudo systemctl enable unbound
    sudo systemctl restart unbound

    echo ""
    echo "Unbound is installed and listening on $SERVER_IP (and 127.0.0.1)."
    echo "Test it with: dig @$SERVER_IP example.com"
    echo ""
    echo "For a redundant setup, run this same script on your second server,"
    echo "then configure your clients with both resolver IP addresses."
}

# Main script execution
echo "DNS Caching Server or DNS Server Installation for Debian, CentOS/RHEL, and Arch"

detect_distro

echo "Choose the type of DNS server to install:"
echo "1. DNS Caching Server (dnsmasq)"
echo "2. DNS Server (bind9)"
echo "3. Recursive/Caching DNS Resolver (unbound)"
read -rp "Enter your choice (1, 2 or 3): " SERVER_CHOICE

case $SERVER_CHOICE in
    1)
        echo "Installing DNS Caching Server (dnsmasq)..."
        install_dns_caching
        echo "DNS Caching Server installed and configured successfully."
        ;;
    2)
        echo "Installing DNS Server (bind9)..."
        install_dns_server
        echo "DNS Server installed and configured successfully."
        ;;
    3)
        echo "Installing Recursive/Caching DNS Resolver (unbound)..."
        install_unbound
        echo "Unbound DNS Resolver installed and configured successfully."
        ;;
    *)
        echo "Invalid choice. Please run the script again and select 1, 2 or 3."
        exit 1
        ;;
esac

echo "Installation script completed."
