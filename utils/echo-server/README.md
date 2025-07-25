# Echo Server

A simple TCP/UDP echo server for testing network connectivity in different environments.

## Usage

```bash
# Start server with default settings (port 1505, both TCP and UDP)
go run main.go --verbose

# Custom port and protocols
go run main.go --port 8080 --protocols tcp,udp --verbose

# UDP only
go run main.go --protocols udp --verbose
```

## Docker

```bash
# Build image
docker build -t echo-server .

# Run with host networking
docker run --rm --network host echo-server --verbose --port 1505

# Run with port mapping
docker run --rm -p 1505:1505/tcp -p 1505:1505/udp echo-server --verbose --port 1505
```

## Purpose

This tool was created to debug networking issues when migrating from docker-compose to Kubernetes. It supports:

- **Enhanced UDP protocol** - Allows clients to specify custom reply addresses
- **Verbose logging** - Shows exact packet sources and destinations
- **Both TCP and UDP** - Tests different networking behaviors
- **Containerized deployment** - Works in Docker, Kubernetes, and bare metal

Used for testing connectivity in Docker Desktop, Kind, minikube, and production Kubernetes environments.