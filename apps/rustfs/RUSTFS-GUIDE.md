# RustFS Object Storage - Quick Guide

## Overview
RustFS is an S3-compatible object storage system deployed on your Kubernetes cluster. It's simpler and more performant than MinIO.

## Access Information

### Endpoints
- **API (S3-compatible)**: `http://<node-ip>:30900`
- **Web Console**: `http://<node-ip>:30901/rustfs/console/index.html`
- **Internal ClusterIP**: `rustfs.rustfs.svc.cluster.local:9000`

### Credentials
- **Access Key**: `admin`
- **Secret Key**: `changeme123`

⚠️ **Change these in production** by updating the deployment env vars.

## Storage Configuration
- **Data Volume**: 50Gi persistent storage
- **Logs Volume**: 5Gi persistent storage
- **Namespace**: `rustfs`

## Using RustFS

### 1. Using AWS CLI (S3-Compatible)

Configure AWS CLI:
```bash
aws configure set aws_access_key_id admin
aws configure set aws_secret_access_key changeme123
aws configure set default.region us-east-1
```

Create a bucket:
```bash
aws --endpoint-url http://<node-ip>:30900 s3 mb s3://my-bucket
```

Upload a file:
```bash
aws --endpoint-url http://<node-ip>:30900 s3 cp file.txt s3://my-bucket/
```

List files:
```bash
aws --endpoint-url http://<node-ip>:30900 s3 ls s3://my-bucket/
```

Download a file:
```bash
aws --endpoint-url http://<node-ip>:30900 s3 cp s3://my-bucket/file.txt ./downloaded.txt
```

### 2. Using Python (boto3)

```python
import boto3

s3 = boto3.client(
    's3',
    endpoint_url='http://<node-ip>:30900',
    aws_access_key_id='admin',
    aws_secret_access_key='changeme123',
    region_name='us-east-1'
)

# Create bucket
s3.create_bucket(Bucket='my-bucket')

# Upload file
s3.upload_file('local_file.txt', 'my-bucket', 'remote_file.txt')

# Download file
s3.download_file('my-bucket', 'remote_file.txt', 'downloaded_file.txt')

# List objects
response = s3.list_objects_v2(Bucket='my-bucket')
for obj in response.get('Contents', []):
    print(obj['Key'])
```

### 3. Using Go (AWS SDK)

```go
package main

import (
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/aws/credentials"
    "github.com/aws/aws-sdk-go/aws/session"
    "github.com/aws/aws-sdk-go/service/s3"
)

func main() {
    sess := session.Must(session.NewSession(&aws.Config{
        Endpoint:         aws.String("http://<node-ip>:30900"),
        Region:           aws.String("us-east-1"),
        Credentials:      credentials.NewStaticCredentials("admin", "changeme123", ""),
        S3ForcePathStyle: aws.Bool(true),
    }))

    svc := s3.New(sess)

    // Create bucket
    svc.CreateBucket(&s3.CreateBucketInput{
        Bucket: aws.String("my-bucket"),
    })
}
```

### 4. From Within Kubernetes

Use the internal service endpoint for applications running inside the cluster:

```yaml
env:
- name: S3_ENDPOINT
  value: "http://rustfs.rustfs.svc.cluster.local:9000"
- name: S3_ACCESS_KEY
  value: "admin"
- name: S3_SECRET_KEY
  value: "changeme123"
```

## Management

### Check Status
```bash
kubectl get all -n rustfs
kubectl logs -n rustfs deployment/rustfs -f
```

### Scale (if needed later)
```bash
kubectl scale deployment rustfs -n rustfs --replicas=1
```

### Update Credentials
Edit the deployment:
```bash
kubectl edit deployment rustfs -n rustfs
# Update RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY values
```

### Access Logs
```bash
kubectl logs -n rustfs -l app=rustfs --tail=100 -f
```

## Why RustFS over MinIO?

1. **Performance**: Written in Rust, optimized for speed
2. **Simplicity**: Easier to configure and maintain
3. **Resource Efficient**: Lower memory and CPU footprint
4. **Fully S3-Compatible**: Drop-in replacement for S3/MinIO
5. **Modern Architecture**: Built with modern best practices

## Common Use Cases

### Backup Storage
Store application backups, database dumps, or file archives.

### Static Asset Hosting
Host images, videos, and static files for web applications.

### Data Lake
Store raw data for analytics and processing pipelines.

### Container Image Registry Backend
Use as backend storage for container registries.

### Application File Storage
Store user uploads, documents, and application data.

## Troubleshooting

### Pod not starting
```bash
kubectl describe pod -n rustfs -l app=rustfs
kubectl logs -n rustfs -l app=rustfs
```

### Permission issues
Check PVC permissions and ensure fsGroup is set correctly (UID 10001).

### Connection refused
Verify services are running and NodePort is accessible:
```bash
kubectl get svc -n rustfs
netstat -tuln | grep -E "30900|30901"
```

## Files Reference
- Deployment: `k8s/rustfs-deployment.yaml`
- Service: `k8s/rustfs-service.yaml`
- PVC: `k8s/rustfs-pvc.yaml`
