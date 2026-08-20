#!/usr/bin/env bash

####################################
# Unbound DNS Resolver Installation Script for Debian, CentOS/RHEL, and Arch
# Created by: KeepItTechie
# YouTube Channel: https://youtube.com/@KeepItTechie
# Blog: https://docs.keepittechie.com/
####################################

############################################################
# This script automates the installation and configuration of
# Unbound, a validating, recursive, and caching DNS resolver,
# on Debian, CentOS/RHEL, and Arch-based systems. The user is
# prompted for the upstream DNS servers and the networks that
# are allowed to query the resolver.
#
# Author: KeepItTechie
# Version: 1.0
# License: MIT
#
# Usage:
#   1. Save the script to a file, for example, unbound.sh.
#   2. Make the script executable:
#      chmod +x unbound.sh
#   3. Run the script:
#      sudo ./unbound.sh
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

# Function to install Unbound based on the detected distribution
install_unbound() {
    case "$DISTRO" in
        ubuntu|debian)
            sudo apt update
            sudo apt install -y unbound
            ;;
        centos|rhel|rocky|alma)
            sudo dnf install -y unbound
            ;;
        arch)
            sudo pacman -Sy --noconfirm unbound
            ;;
        *)
            echo "Unsupported distribution!"
            exit 1
            ;;
    esac
}

# Function to configure Unbound as a caching resolver
configure_unbound() {
    echo "Enter the network allowed to query this resolver (e.g., 192.168.1.0/24): "
    read ALLOWED_NETWORK

    echo "Enter the primary upstream DNS server (e.g., 1.1.1.1): "
    read UPSTREAM_DNS_1

    echo "Enter the secondary upstream DNS server (e.g., 8.8.8.8): "
    read UPSTREAM_DNS_2

    # Determine the configuration directory used by the distribution
    if [ -d /etc/unbound/unbound.conf.d ]; then
        CONF_FILE="/etc/unbound/unbound.conf.d/linservarsenal.conf"
    else
        CONF_FILE="/etc/unbound/unbound.conf"
    fi

    sudo tee "$CONF_FILE" > /dev/null <<EOF
server:
    # Listen on all interfaces for both IPv4 and IPv6
    interface: 0.0.0.0
    interface: ::0
    port: 53

    # Allow queries from the local host and the specified network
    access-control: 127.0.0.0/8 allow
    access-control: ::1 allow
    access-control: $ALLOWED_NETWORK allow

    # Caching and performance tuning
    cache-min-ttl: 300
    cache-max-ttl: 86400
    prefetch: yes
    num-threads: 2

    # Privacy and security hardening
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    use-caps-for-id: yes

forward-zone:
    name: "."
    forward-addr: $UPSTREAM_DNS_1
    forward-addr: $UPSTREAM_DNS_2
EOF

    # Validate the configuration before restarting the service
    if command -v unbound-checkconf &> /dev/null; then
        sudo unbound-checkconf "$CONF_FILE"
    fi

    sudo systemctl restart unbound
    sudo systemctl enable unbound
}

# Main script execution
echo "Unbound DNS Resolver Installation for Debian, CentOS/RHEL, and Arch"

detect_distro

echo "Installing Unbound..."
install_unbound

echo "Configuring Unbound..."
configure_unbound

echo "Unbound DNS resolver installed and configured successfully."
echo "Installation script completed."
