# Echo Client

A TCP/UDP echo client for testing network connectivity and protocol behavior.

## Usage

```bash
# Basic TCP test
go run main.go --protocol tcp --host localhost --port 1505 --verbose

# Basic UDP test
go run main.go --protocol udp --host localhost --port 1505 --verbose

# UDP with custom reply address (advanced)
go run main.go --protocol udp --host localhost --port 1505 --reply-host 192.168.1.100 --reply-port 9999 --verbose
```

## Features

- **Auto-detection** - Automatically detects local IP and picks random ports for UDP replies
- **Separate sockets** - Uses separate send/receive sockets for UDP to avoid routing issues
- **Enhanced UDP protocol** - Supports custom reply addresses for testing complex networking scenarios
- **Verbose logging** - Shows connection details, message flow, and timing

## Docker

```bash
# Build image
docker build -t echo-client .

# Run test
docker run --rm echo-client --protocol udp --host host.docker.internal --port 1505 --verbose
```

## Purpose

This tool was created to debug networking issues when migrating from docker-compose to Kubernetes. It helps identify:

- **Network reachability** - Can packets reach the destination?
- **UDP routing issues** - Are responses coming back to the right address?
- **Container networking** - How do different container runtimes handle networking?
- **Protocol behavior** - TCP vs UDP behavior in various environments

Used for testing connectivity across Docker Desktop, Kind, minikube, and production Kubernetes environments.