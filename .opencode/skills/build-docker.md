# Skill: Build Docker Image & Push to AWS ECR

## Trigger

Use this skill when the user says any of the following (or similar):
- "build the Docker image"
- "containerize the backend"
- "push to ECR"
- "build and push"
- "create a Docker image"
- "package the app for deployment"
- "update the container"

---

## Context

Before starting, read and understand:

1. **`Dockerfile`** at project root — multi-stage build using the official Bun base image
2. **`infra/ecr.env`** (or `.env`) for ECR repository URI and region
3. **`.dockerignore`** — must exclude `.env`, `node_modules`, `data/`, `backend/protocols/`

The Docker image packages **only the backend** (`backend/` workspace). The frontend is a static build deployed separately (S3 + CloudFront or served by the backend in production).

**Base image:** `oven/bun:1` (official Bun Docker image). Never use `node:*` base images.

**Build stages:**
1. `builder` — installs all dependencies, compiles TypeScript, runs `bun build`
2. `runner` — minimal Bun runtime image, copies compiled output only

---

## Steps

### 1. Pre-flight checks

Verify all required tools are installed:
```bash
docker --version
aws --version
aws sts get-caller-identity
```

Ensure you are authenticated to the correct AWS account.

### 2. Set environment variables

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=rapidresponse-backend
export IMAGE_TAG=$(git rev-parse --short HEAD)
export ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
```

### 3. Authenticate Docker to ECR

```bash
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
```

### 4. Create ECR repository (first time only)

```bash
aws ecr describe-repositories --repository-names $ECR_REPO 2>/dev/null \
  || aws ecr create-repository \
      --repository-name $ECR_REPO \
      --image-scanning-configuration scanOnPush=true \
      --region $AWS_REGION
```

### 5. Build the Docker image

```bash
docker build \
  --platform linux/amd64 \
  -t "${ECR_URI}:${IMAGE_TAG}" \
  -t "${ECR_URI}:latest" \
  .
```

Always build for `linux/amd64` (ECS Fargate target), even on Apple Silicon.

### 6. Push to ECR

```bash
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:latest"
```

### 7. Verify the push

```bash
aws ecr describe-images \
  --repository-name $ECR_REPO \
  --region $AWS_REGION \
  --query 'imageDetails[*].{Tag:imageTags,Pushed:imagePushedAt}' \
  --output table
```

---

## Dockerfile Reference

The project Dockerfile should follow this structure:

```dockerfile
# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bunfig.toml ./
COPY backend/package.json ./backend/
RUN bun install --frozen-lockfile
COPY backend/ ./backend/
RUN bun run build:backend

# Stage 2: Runtime
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "dist/index.js"]
```

---

## Commands

| Command | Description |
|---|---|
| `bun run docker:build` | Build the image (wraps the docker build command above) |
| `bun run docker:push` | Tag and push to ECR (requires ECR env vars) |
| `bun run docker:build-push` | Build and push in one step |

---

## Verification

- [ ] `docker build` completes with no errors
- [ ] Image size is reasonable (< 500 MB)
- [ ] `docker run --env-file .env -p 3000:3000 <image>` starts successfully locally
- [ ] `GET http://localhost:3000/health` returns `{ "status": "ok" }`
- [ ] ECR shows the new image tag in `aws ecr describe-images`

---

## Error Handling

| Error | Likely Cause | Fix |
|---|---|---|
| `no space left on device` | Docker disk full | `docker system prune -f` |
| `exec format error` at runtime | Wrong platform | Add `--platform linux/amd64` to build command |
| `denied: Your authorization token has expired` | ECR token expired | Re-run the `aws ecr get-login-password` step |
| `bun: command not found` in build | Wrong base image | Ensure `FROM oven/bun:1` not `FROM node:*` |
| Bun lockfile mismatch | `bun.lockb` out of sync | Run `bun install` locally and commit updated `bun.lockb` |

---

## Security Notes

- **Never** copy `.env` into the Docker image. Use ECS task environment variables or Secrets Manager.
- **Never** include `data/lancedb/` in the image — LanceDB data is volume-mounted in production.
- **Never** include `backend/protocols/` in the image — protocols are managed separately.
- The `.dockerignore` must include: `.env`, `*.env`, `data/`, `backend/protocols/`, `.opencode/`
