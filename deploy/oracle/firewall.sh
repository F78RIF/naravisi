#!/usr/bin/env bash
# NaraVisi · deploy/oracle/firewall.sh
# Fungsi   : Firewall VM Ubuntu Oracle Cloud: hanya port 22 (SSH), 80 (HTTP), 443 (HTTPS) yang diterima.
# Kebutuhan: RNF-07 (keamanan koneksi)
# Terkait  : deploy/ORACLE_FREE.md bagian 4 (Security List di konsol Oracle = lapis pertama)
# Pemakaian: sudo bash deploy/oracle/firewall.sh
#
# Image Ubuntu Oracle memakai iptables (bukan ufw) dan sudah menolak semua port kecuali 22 lewat aturan REJECT.
# Skrip ini menyisipkan izin 80 & 443 SEBELUM aturan REJECT, lalu menyimpannya agar tetap ada setelah reboot.
# Aman dijalankan berulang (aturan yang sudah ada tidak ditambah dua kali).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan dengan sudo: sudo bash $0" >&2
  exit 1
fi

if ! command -v netfilter-persistent >/dev/null 2>&1; then
  echo "Memasang iptables-persistent ..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi

for port in 22 80 443; do
  rule=(-p tcp -m state --state NEW --dport "$port" -j ACCEPT)
  if iptables -C INPUT "${rule[@]}" 2>/dev/null; then
    echo "Port $port sudah diizinkan."
    continue
  fi
  reject_line=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
  if [ -n "$reject_line" ]; then
    iptables -I INPUT "$reject_line" "${rule[@]}"
  else
    iptables -A INPUT "${rule[@]}"
  fi
  echo "Port $port diizinkan."
done

# Port lain (mis. 3000 backend, 8000 AI, 3306 MySQL) tidak diizinkan; di Docker pun tidak ada "ports:" untuk itu.
if ! iptables -L INPUT -n | awk '$1 == "REJECT"' | grep -q .; then
  iptables -A INPUT -j REJECT --reject-with icmp-host-prohibited
  echo "Aturan REJECT penutup ditambahkan."
fi

netfilter-persistent save
echo
echo "Aturan INPUT sekarang:"
iptables -L INPUT -n --line-numbers
