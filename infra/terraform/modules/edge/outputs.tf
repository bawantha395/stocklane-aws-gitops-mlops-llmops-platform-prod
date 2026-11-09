output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_url" {
  value = "https://${var.web_domain}"
}
