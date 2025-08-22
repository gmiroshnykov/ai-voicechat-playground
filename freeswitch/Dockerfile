FROM drachtio/drachtio-freeswitch-mrf:0.9.4

# Replace the entrypoint with our custom one that supports --password-file
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/entrypoint.sh"]