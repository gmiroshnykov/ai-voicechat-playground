# Deploy using Helm with values from values.local.yaml (gitignored)
k8s_yaml(helm('./helm/firefly', values=['./helm/firefly/values.local.yaml']))

# Build and deploy Firefly service with live updates
docker_build(
    'firefly:latest',
    context='./firefly',
    dockerfile='./firefly/Dockerfile',
    live_update=[
        sync('./firefly/src', '/app/src'),
        run('npm run build', trigger=['./firefly/src/**/*.ts', './firefly/src/**/*.js']),
    ]
)

# Set resource dependencies
k8s_resource('firefly', resource_deps=['drachtio'])

