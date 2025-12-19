#!/bin/bash
#
# PID Logger - Shell-based process tracking for network connections
#
# This script tracks which process is using a specific source port by
# reading /proc/net/tcp and scanning /proc/[pid]/fd/ directories.
#
# Usage:
#   ./pid-logger.sh <source_port>
#   ./pid-logger.sh 45678
#
# Output (JSON):
#   {"srcPort":45678,"pid":12345,"cmdline":"curl https://github.com","comm":"curl","inode":"123456"}
#
# Exit codes:
#   0 - Success, process found
#   1 - Error (invalid arguments, port not found, etc.)
#
# Note: This script requires read access to /proc filesystem and may need
# appropriate permissions to read other processes' fd directories.
#

set -e

# Function to convert hex port to decimal
hex_to_dec() {
  printf "%d" "0x$1"
}

# Function to convert little-endian hex IP to dotted decimal
hex_to_ip() {
  local hex="$1"
  # /proc/net/tcp stores IPs in little-endian format
  local b1=$((16#${hex:6:2}))
  local b2=$((16#${hex:4:2}))
  local b3=$((16#${hex:2:2}))
  local b4=$((16#${hex:0:2}))
  echo "$b1.$b2.$b3.$b4"
}

# Function to find inode for a given port
find_inode_for_port() {
  local target_port="$1"
  local inode=""
  
  # Skip header line and parse each connection
  tail -n +2 /proc/net/tcp 2>/dev/null | while read -r line; do
    # Parse local address (field 2, format: ADDR:PORT)
    local local_addr
    local_addr=$(echo "$line" | awk '{print $2}')
    local port_hex
    port_hex=$(echo "$local_addr" | cut -d: -f2)
    local port_dec
    port_dec=$(hex_to_dec "$port_hex")
    
    if [ "$port_dec" -eq "$target_port" ]; then
      # Get inode (field 10)
      echo "$line" | awk '{print $10}'
      return 0
    fi
  done
}

# Function to find process owning a socket inode
find_process_for_inode() {
  local target_inode="$1"
  
  # Scan all numeric directories in /proc (these are PIDs)
  for pid_dir in /proc/[0-9]*; do
    local pid
    pid=$(basename "$pid_dir")
    
    # Check if fd directory is readable
    if [ -d "$pid_dir/fd" ] && [ -r "$pid_dir/fd" ]; then
      # Check each file descriptor
      for fd in "$pid_dir/fd"/*; do
        if [ -L "$fd" ]; then
          local link_target
          link_target=$(readlink "$fd" 2>/dev/null || true)
          if [ "$link_target" = "socket:[$target_inode]" ]; then
            echo "$pid"
            return 0
          fi
        fi
      done
    fi
  done 2>/dev/null
  
  return 1
}

# Function to get process command line
get_cmdline() {
  local pid="$1"
  if [ -r "/proc/$pid/cmdline" ]; then
    # cmdline is null-separated, convert to spaces
    tr '\0' ' ' < "/proc/$pid/cmdline" | sed 's/ $//'
  else
    echo "unknown"
  fi
}

# Function to get process short name
get_comm() {
  local pid="$1"
  if [ -r "/proc/$pid/comm" ]; then
    cat "/proc/$pid/comm" | tr -d '\n'
  else
    echo "unknown"
  fi
}

# Function to escape JSON string
json_escape() {
  local str="$1"
  # Escape backslashes first, then quotes
  str="${str//\\/\\\\}"
  str="${str//\"/\\\"}"
  # Escape control characters
  str="${str//$'\n'/\\n}"
  str="${str//$'\r'/\\r}"
  str="${str//$'\t'/\\t}"
  echo "$str"
}

# Function to output JSON result
output_json() {
  local src_port="$1"
  local pid="$2"
  local cmdline="$3"
  local comm="$4"
  local inode="$5"
  local error="$6"
  
  cmdline=$(json_escape "$cmdline")
  comm=$(json_escape "$comm")
  
  if [ -n "$error" ]; then
    error=$(json_escape "$error")
    echo "{\"srcPort\":$src_port,\"pid\":$pid,\"cmdline\":\"$cmdline\",\"comm\":\"$comm\",\"error\":\"$error\"}"
  elif [ -n "$inode" ]; then
    echo "{\"srcPort\":$src_port,\"pid\":$pid,\"cmdline\":\"$cmdline\",\"comm\":\"$comm\",\"inode\":\"$inode\"}"
  else
    echo "{\"srcPort\":$src_port,\"pid\":$pid,\"cmdline\":\"$cmdline\",\"comm\":\"$comm\"}"
  fi
}

# Main function
main() {
  local src_port="$1"
  
  # Validate arguments
  if [ -z "$src_port" ]; then
    echo "Usage: $0 <source_port>" >&2
    echo "Example: $0 45678" >&2
    exit 1
  fi
  
  # Validate port is numeric
  if ! [[ "$src_port" =~ ^[0-9]+$ ]]; then
    output_json "$src_port" -1 "unknown" "unknown" "" "Invalid port: must be numeric"
    exit 1
  fi
  
  # Check if /proc/net/tcp exists
  if [ ! -r /proc/net/tcp ]; then
    output_json "$src_port" -1 "unknown" "unknown" "" "Cannot read /proc/net/tcp"
    exit 1
  fi
  
  # Find inode for the port
  local inode
  inode=$(find_inode_for_port "$src_port")
  
  if [ -z "$inode" ] || [ "$inode" = "0" ]; then
    output_json "$src_port" -1 "unknown" "unknown" "" "No socket found for port $src_port"
    exit 1
  fi
  
  # Find process owning the socket
  local pid
  pid=$(find_process_for_inode "$inode")
  
  if [ -z "$pid" ]; then
    output_json "$src_port" -1 "unknown" "unknown" "$inode" "Socket inode $inode found but no process owns it"
    exit 1
  fi
  
  # Get process information
  local cmdline
  cmdline=$(get_cmdline "$pid")
  local comm
  comm=$(get_comm "$pid")
  
  # Output result
  output_json "$src_port" "$pid" "$cmdline" "$comm" "$inode"
  exit 0
}

main "$@"
