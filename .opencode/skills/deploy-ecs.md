# Skill: Deploy to AWS ECS

## Trigger

Use this skill when the user says any of the following (or similar):
- "deploy to AWS"
- "push a new release"
- "update the ECS service"
- "deploy the new version"
- "release to production"
- "update the running container"
- "ship it"
- "deploy to Fargate"

---

## Context

Before starting, read and understand:

1. **`infra/task-definition.json`** — ECS task definition template
2. The Docker image must already be built and pushed to ECR (run the `build-docker` skill first if not)
3. All environment variables must be stored in **AWS Secrets Manager** or the ECS task definition environment section — never baked into the image

**Infrastructure overview:**
- ECS cluster: `rapidresponse-cluster`
- ECS service: `rapidresponse-backend`
- Task definition family: `rapidresponse-backend`
- Container name: `rapidresponse-backend`
- Load balancer: ALB in front of ECS service
- LanceDB data: EFS volume mounted at `/app/data/lancedb`
- Port: `3000` (container) → `80/443` (ALB)

---

## Steps

### Pre-flight Checklist

Before deploying, confirm all of the following:

- [ ] Docker image is built and pushed to ECR (see `build-docker` skill)
- [ ] All migrations are applied to the production Turso database
- [ ] New environment variables (if any) are added to Secrets Manager or task definition
- [ ] `bun run test` passes on the branch being deployed
- [ ] No `.env` files were accidentally included in the Docker image

### 1. Set deployment variables

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=rapidresponse-backend
export IMAGE_TAG=$(git rev-parse --short HEAD)
export ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
export CLUSTER=rapidresponse-cluster
export SERVICE=rapidresponse-backend
export TASK_FAMILY=rapidresponse-backend
```

### 2. Update the task definition image URI

Fetch the current task definition, update the image URI, and register a new revision:

```bash
# Get current task definition
aws ecs describe-task-definition \
  --task-definition $TASK_FAMILY \
  --region $AWS_REGION \
  --query 'taskDefinition' \
  > /tmp/task-def.json

# Update image URI in the task definition
jq --arg IMAGE "$ECR_URI" \
  '.containerDefinitions[0].image = $IMAGE
   | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
         .compatibilities, .registeredAt, .registeredBy)' \
  /tmp/task-def.json > /tmp/new-task-def.json

# Register new task definition revision
aws ecs register-task-definition \
  --cli-input-json file:///tmp/new-task-def.json \
  --region $AWS_REGION
```

### 3. Update the ECS service

```bash
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --task-definition $TASK_FAMILY \
  --force-new-deployment \
  --region $AWS_REGION
```

### 4. Wait for deployment to stabilize

```bash
echo "Waiting for service to stabilize..."
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $AWS_REGION
echo "Deployment complete."
```

This command blocks until ECS reports the service as stable (all desired tasks are running the new version). Timeout: ~10 minutes.

### 5. Verify the deployment

```bash
# Check running task count and status
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $AWS_REGION \
  --query 'services[0].{Running:runningCount,Desired:desiredCount,Pending:pendingCount,Status:status}'

# Get the public ALB DNS name and health check
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names rapidresponse-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)
curl -sf "https://${ALB_DNS}/health" | jq .
```

Expected response from `/health`:
```json
{ "status": "ok", "version": "<IMAGE_TAG>" }
```

### 6. Tail CloudWatch logs (optional)

```bash
aws logs tail "/ecs/rapidresponse-backend" \
  --follow \
  --region $AWS_REGION \
  --since 5m
```

---

## Commands

| Command | Description |
|---|---|
| `bun run deploy` | Full deploy: build → push → update ECS → wait for stable |
| `bun run deploy:update-service` | Update ECS service only (assumes image already pushed) |
| `bun run deploy:logs` | Tail CloudWatch logs for the running tasks |
| `bun run deploy:status` | Print current ECS service status and task counts |

---

## Required IAM Permissions (Deploying User/Role)

```json
{
  "ecs:RegisterTaskDefinition",
  "ecs:UpdateService",
  "ecs:DescribeServices",
  "ecs:DescribeTaskDefinition",
  "ecs:ListTaskDefinitions",
  "iam:PassRole",
  "ecr:GetAuthorizationToken",
  "ecr:BatchCheckLayerAvailability",
  "ecr:PutImage",
  "logs:DescribeLogGroups",
  "logs:GetLogEvents"
}
```

## Required IAM Permissions (ECS Task Role)

```json
{
  "bedrock:InvokeModel",
  "bedrock:InvokeModelWithResponseStream",
  "s3:PutObject",
  "s3:GetObject",
  "s3:ListBucket",
  "s3:DeleteObject",
  "secretsmanager:GetSecretValue"
}
```

---

## Rollback

To roll back to a previous task definition revision:

```bash
# List recent task definition revisions
aws ecs list-task-definitions \
  --family-prefix $TASK_FAMILY \
  --sort DESC \
  --region $AWS_REGION \
  --query 'taskDefinitionArns[:5]'

# Update service to a specific revision (e.g. revision 12)
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --task-definition "${TASK_FAMILY}:12" \
  --force-new-deployment \
  --region $AWS_REGION

aws ecs wait services-stable --cluster $CLUSTER --services $SERVICE --region $AWS_REGION
```

---

## Verification

- [ ] `aws ecs wait services-stable` exits without error
- [ ] Running task count equals desired task count
- [ ] `GET /health` on the ALB DNS returns `{ "status": "ok" }`
- [ ] CloudWatch logs show no fatal errors in the first 2 minutes
- [ ] Dispatcher dashboard loads and SSE `/events` stream connects
- [ ] A test WebSocket call to `/call` connects successfully

---

## Error Handling

| Error | Likely Cause | Fix |
|---|---|---|
| Service stuck in `DRAINING` | Old tasks not stopping | Check if health check is failing; review CloudWatch logs |
| `CannotPullContainerError` | ECR auth failed or image not found | Verify ECR URI and that the image tag exists |
| Tasks failing health check | App crash on startup | Check CloudWatch logs for startup errors; verify all env vars |
| `AccessDeniedException` for Bedrock | Task role missing Bedrock permissions | Add `bedrock:InvokeModel` to the ECS task role |
| LanceDB mount error | EFS not mounted | Verify EFS mount target is in the same AZ as the ECS task |
| `TURSO_AUTH_TOKEN` missing | Secret not injected | Check Secrets Manager ARN in task definition `secrets` section |
