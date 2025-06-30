# FreeSWITCH VoIP Echo Service

A FreeSWITCH configuration that provides VoIP echo functionality for incoming calls from SIP providers like Kyivstar.

## Features

- **VoIP Echo Service**: Accepts incoming calls and echoes caller's voice back
- **NAT-Friendly**: Configured to work with router SIP ALG (tested with Asus RT-AX88U)
- **Provider Integration**: Supports SIP trunk registration with external providers
- **Security**: Uses ACLs to restrict access to authorized IP ranges

## Setup

### 1. Configure SIP Provider Settings

Copy the template files and replace placeholders with your actual credentials:

```bash
# Copy templates to actual config files
cp conf/sip_profiles/external.xml.template conf/sip_profiles/external.xml
cp conf/dialplan/public.xml.template conf/dialplan/public.xml
```

### 2. Edit Configuration Files

**In `conf/sip_profiles/external.xml`:**
- Replace `YOUR_SIP_USERNAME` with your SIP username/phone number
- Replace `YOUR_SIP_PASSWORD` with your SIP password

**In `conf/dialplan/public.xml`:**
- Replace `YOUR_PHONE_NUMBER` with your phone number

**In `conf/autoload_configs/acl.conf.xml`:**
- Update the CIDR range to match your SIP provider's IP range

### 3. Start FreeSWITCH

```bash
./run.sh
```

### 4. Verify Registration

In the FreeSWITCH console:
```
sofia status
sofia status gateway YOUR_GATEWAY_NAME
```

## Network Configuration

This configuration is designed to work with routers that have SIP ALG (Application Layer Gateway) enabled:

- Uses local IP addresses instead of STUN
- Enables media bypass for direct RTP flow
- Trusts router to handle NAT translation

## Security Notes

- **Never commit credentials**: The actual config files are in `.gitignore`
- **Use ACLs**: Restrict access to known provider IP ranges
- **Monitor logs**: Check for unauthorized access attempts
- **Firewall**: Consider additional firewall rules for RTP port ranges

## Testing

Call your configured phone number from an external phone. You should:
1. Hear the call connect
2. Hear your own voice echoed back
3. See call logs in FreeSWITCH console

## Troubleshooting

### Registration Issues
- Check credentials in `external.xml`
- Verify provider server address and port
- Check network connectivity to provider

### Audio Issues  
- Verify router SIP ALG is enabled
- Check ACL configuration allows provider IPs
- Review RTP port configuration

### NAT Issues
- Ensure `external_rtp_ip` and `external_sip_ip` use local IP
- Verify media bypass settings
- Check router NAT/firewall configuration