terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 6.0, < 7.0" }
    archive = { source = "hashicorp/archive", version = ">= 2.4, < 3.0" }
  }
  # bucket, key and region come from the pipeline: terraform init -backend-config=...
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.name, Environment = "prod", ManagedBy = "Terraform" } }
}

# CloudFront only accepts certificates from us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { Project = var.name, Environment = "prod", ManagedBy = "Terraform" } }
}

data "aws_caller_identity" "current" {}
