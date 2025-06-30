# FreeSWITCH VoIP Echo Service

A FreeSWITCH configuration that provides VoIP echo functionality for incoming calls from SIP providers. This setup uses a native FreeSWITCH installation (via Homebrew) and is pre-configured for Kyivstar VoIP service.

## Features

- **VoIP Echo Service**: Accepts incoming calls and echoes caller's voice back using built-in echo application
- **NAT-Friendly**: Configured to work with router SIP ALG by using local IP addresses
- **Provider Integration**: Pre-configured for Kyivstar SIP trunk registration
- **Security**: Uses ACLs to restrict access to authorized IP ranges (currently configured for Kyivstar's network)
- **High-Quality Audio**: Supports OPUS codec for better audio quality, with PCMU/PCMA fallback
- **Minimal Configuration**: Streamlined config with only essential modules loaded

## Current Configuration

The FreeSWITCH setup is currently configured with:
- **SIP Provider**: Kyivstar (voip.kyivstar.ua)
- **Phone Number**: [Your assigned phone number] (configured in external.xml)
- **ACL Network**: 188.163.212.0/24 (Kyivstar's IP range)
- **Codecs**: OPUS, PCMU, PCMA (in order of preference)
- **Ports**: Internal SIP (5060), External SIP (5080)

## Setup

### 1. Prerequisites

- FreeSWITCH installed via Homebrew: `/opt/homebrew/bin/freeswitch`
- macOS (configured for Homebrew paths)

### 2. Configuration Files

The main configuration files are:

**Template Files (for new setups):**
- `conf/sip_profiles/external.xml.template` - SIP provider configuration template
- `conf/dialplan/public.xml.template` - Dialplan template for incoming calls

**Active Configuration Files:**
- `conf/sip_profiles/external.xml` - Contains actual Kyivstar credentials
- `conf/dialplan/public.xml` - Routes calls to your phone number to echo application
- `conf/autoload_configs/acl.conf.xml` - Restricts access to Kyivstar network
- `conf/vars.xml` - Global variables and network settings
- `conf/autoload_configs/modules.conf.xml` - Minimal module loading

### 3. For New Provider Setup

If configuring for a different SIP provider:

```bash
# Copy templates to actual config files
cp conf/sip_profiles/external.xml.template conf/sip_profiles/external.xml
cp conf/dialplan/public.xml.template conf/dialplan/public.xml
```

Then edit the files:

**In `conf/sip_profiles/external.xml`:**
- Replace `YOUR_SIP_USERNAME` with your SIP username/phone number
- Replace `YOUR_SIP_PASSWORD` with your SIP password
- Update `realm` and `proxy` for your provider

**In `conf/dialplan/public.xml`:**
- Replace `YOUR_PHONE_NUMBER` with your phone number in the destination_number condition

**In `conf/autoload_configs/acl.conf.xml`:**
- Update the CIDR range to match your SIP provider's IP range

### 4. Start FreeSWITCH

```bash
./run.sh
```

The script will:
- Create required directories (`log/`, `db/`)
- Start FreeSWITCH in foreground mode with console access
- Use the custom configuration directory

### 5. Verify Registration

In the FreeSWITCH console:
```
sofia status
sofia status gateway kyivstar
```

## Network Configuration

This configuration is optimized for NAT environments:

- **Local IP Usage**: Uses `$${local_ip_v4}` for both RTP and SIP IP addresses
- **No STUN**: Relies on router SIP ALG instead of STUN servers
- **Media Bypass**: Configured for direct RTP flow when possible
- **TCP Transport**: Uses TCP for SIP registration (more reliable than UDP)

## Directory Structure

```
freeswitch/
├── Dockerfile              # Docker build file (for containerized deployment)
├── README.md               # This file
├── run.sh                  # Native FreeSWITCH startup script
├── conf/                   # FreeSWITCH configuration
│   ├── freeswitch.xml      # Main configuration file
│   ├── vars.xml            # Global variables and network settings
│   ├── autoload_configs/   # Module and service configurations
│   │   ├── acl.conf.xml    # Access control lists
│   │   ├── modules.conf.xml # Minimal module loading
│   │   └── ...
│   ├── sip_profiles/       # SIP profile configurations
│   │   ├── external.xml    # External SIP profile (provider connection)
│   │   ├── external.xml.template # Template for new setups
│   │   └── internal.xml    # Internal SIP profile
│   ├── dialplan/           # Call routing logic
│   │   ├── public.xml      # Public context (incoming calls)
│   │   ├── public.xml.template # Template for new setups
│   │   └── ...
│   └── directory/          # User directory
│       └── default/
│           └── echo.xml    # Echo user configuration
├── db/                     # FreeSWITCH database files (created at runtime)
└── log/                    # Log files (created at runtime)
```

## Security Notes

- **Credentials Not in Git**: The actual `external.xml` contains real credentials and is not tracked in git
- **ACL Protection**: Only allows connections from configured IP ranges (currently Kyivstar)
- **No Authentication Bypass**: `accept-blind-auth` is set to `false`
- **Firewall**: Consider additional firewall rules for RTP port ranges

## Testing

Call the configured phone number (442475707 for current setup) from an external phone. You should:
1. Hear the call connect
2. Hear your own voice echoed back immediately
3. See call logs in FreeSWITCH console with "built-in echo" message

## Troubleshooting

### Registration Issues
- Check credentials in `external.xml`
- Verify provider server address and port
- Check network connectivity: `ping voip.kyivstar.ua`
- Review FreeSWITCH logs in `log/freeswitch.log`

### Audio Issues  
- Verify router SIP ALG is enabled
- Check ACL configuration allows provider IPs
- Review codec negotiation in logs
- Ensure RTP ports are not blocked by firewall

### NAT Issues
- Verify `external_rtp_ip` and `external_sip_ip` are using local IP
- Check that `$${local_ip_v4}` resolves correctly
- Review router NAT/firewall configuration
- Consider disabling media bypass if RTP doesn't flow properly

### Module Loading Issues
- Check `modules.conf.xml` for missing essential modules
- Verify OPUS codec module is available in your FreeSWITCH build
- Review startup logs for module loading errors

## Development Notes

- **Homebrew Installation**: Configured for FreeSWITCH installed via Homebrew on macOS
- **Docker Support**: Dockerfile available for containerized deployment
- **Minimal Config**: Only essential modules loaded for better performance
- **Debug Enabled**: SIP tracing enabled for troubleshooting