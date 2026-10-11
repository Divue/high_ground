output "site_url" {
  value = local.site_url
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "data_bucket" {
  value = aws_s3_bucket.data.bucket
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "amplify_app_id" {
  value = aws_amplify_app.site.id
}

output "topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "subscribers_table" {
  value = aws_dynamodb_table.subscribers.name
}

output "bedrock_model_id" {
  value = var.bedrock_model_id
}

output "address_search_enabled" {
  value = var.enable_address_search
}
