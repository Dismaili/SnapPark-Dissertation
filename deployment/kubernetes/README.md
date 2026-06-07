# SnapPark — Kubernetes Deployment

This directory contains the Kubernetes manifests required to run the full SnapPark
platform on any conformant Kubernetes cluster (minikube, kind, GKE, EKS, AKS).

## Files

| File | Purpose |
|------|---------|
| `namespace.yaml` | Creates the `snappark` namespace used by every other resource |
| `configmap.yaml` | Non-sensitive configuration shared by all services |
| `secrets.example.yaml` | Template for the two `Secret` resources (copy to `secrets.yaml` and populate) |
| `postgres.yaml` | Three `StatefulSet`s (auth, case, notifications) + headless `Service`s + `PersistentVolumeClaim`s |
| `rabbitmq.yaml` | RabbitMQ `StatefulSet` with management plugin and persistent storage |
| `api-gateway.yaml` | API gateway `Deployment` + `LoadBalancer` `Service` |
| `auth-service.yaml` | Authentication service `Deployment` + `ClusterIP` `Service` |
| `violation-service.yaml` | Violation analysis service `Deployment` + `ClusterIP` `Service` |
| `notification-service.yaml` | Notification service `Deployment` + `ClusterIP` `Service` |
| `ingress.yaml` | Optional `Ingress` exposing the API gateway through nginx-ingress |
| `hpa.yaml` | Horizontal pod autoscalers for every application tier |

## Prerequisites

- `kubectl` configured against a running cluster
- Container images built and available to the cluster either locally
  (e.g. `minikube image load`) or pushed to a registry accessible to the cluster
- `metrics-server` installed if you plan to apply `hpa.yaml`
- An ingress controller (e.g. `ingress-nginx`) installed if you plan to apply `ingress.yaml`

## Deployment Order

Order matters — data-plane components must be ready before the services that
depend on them. Apply in this sequence:

```bash
# 1. Namespace first
kubectl apply -f namespace.yaml

# 2. Configuration and secrets
kubectl apply -f configmap.yaml
cp secrets.example.yaml secrets.yaml
# ... edit secrets.yaml with real values ...
kubectl apply -f secrets.yaml

# 3. Data plane
kubectl apply -f postgres.yaml
kubectl apply -f rabbitmq.yaml

# 4. Wait until all stateful pods are Ready
kubectl rollout status statefulset/postgres-auth -n snappark
kubectl rollout status statefulset/postgres-case -n snappark
kubectl rollout status statefulset/postgres-notifications -n snappark
kubectl rollout status statefulset/rabbitmq -n snappark

# 5. Application tier
kubectl apply -f auth-service.yaml
kubectl apply -f violation-service.yaml
kubectl apply -f notification-service.yaml
kubectl apply -f api-gateway.yaml

# 6. Optional — autoscaling and ingress
kubectl apply -f hpa.yaml
kubectl apply -f ingress.yaml
```

## Verification

```bash
# Everything in the namespace
kubectl get all -n snappark

# Watch rollouts
kubectl rollout status deployment/api-gateway -n snappark
kubectl rollout status deployment/authentication-service -n snappark
kubectl rollout status deployment/violation-analysis-service -n snappark
kubectl rollout status deployment/notification-service -n snappark

# Hit the API gateway from your laptop
kubectl port-forward svc/api-gateway 3000:80 -n snappark
curl http://localhost:3000/health
```

## Configuration Notes

- **Secrets** are split into three resources: `snappark-secrets` (app secrets),
  `postgres-credentials` (DB superuser), `rabbitmq-credentials` (broker). All
  three live in `secrets.example.yaml`.
- **Replicas** default to 2 for every application tier to allow rolling updates
  without downtime. Scale further via `kubectl scale` or let `hpa.yaml` do it.
- **Images** are referenced as `snappark/<service>:1.0.0`. Retag and push to
  your registry, or build into a local cluster's container daemon before
  applying.
- **LoadBalancer vs Ingress** — the API gateway `Service` is typed
  `LoadBalancer` for managed clusters. On local clusters (minikube/kind) use
  `port-forward`, or install an ingress controller and apply `ingress.yaml`.

## Teardown

```bash
kubectl delete namespace snappark
```

This removes every resource created by the manifests in this directory,
including persistent volume claims.
