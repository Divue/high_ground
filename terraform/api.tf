# ---------------------------------------------------------------- API Gateway (HTTP API)
locals {
  routes = merge(
    {
      "POST /subscribe"        = "subscribe"
      "POST /admin/run"        = "forecast_check"
      "POST /ask"              = "assistant"
      "GET /data/current.json" = "current_json"
    },
    # off: the helper answers with an empty list (a missing route is a failed request in the browser)
    { "POST /geocode" = var.enable_address_search ? "geocode" : "current_json" },
  )
  routed = toset(values(local.routes))
}

resource "aws_apigatewayv2_api" "api" {
  name          = var.project
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  # the endpoints are open to the internet (subscribe sends an email, /ask calls a model): cap the rate
  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = local.routed
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "route" {
  for_each  = local.routes
  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.fn[each.value].id}"
}

resource "aws_lambda_permission" "api" {
  for_each      = local.routed
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
