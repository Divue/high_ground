# ---------------------------------------------------------------- the site (Amplify Hosting)
# Serves the web app and, with it, the model outputs the browser reads (/data/...): the same
# one-address layout the local build runs on. deploy.sh uploads the bundle.
locals {
  site_url = "https://main.${aws_amplify_app.site.default_domain}"
}

resource "aws_amplify_app" "site" {
  name     = var.project
  platform = "WEB"

  # tonight's forecast changes every 3 hours, so it is not part of the published site: the
  # forecast-check Lambda writes it to S3 and this rule passes the request on to the API
  custom_rule {
    source = "/data/current.json"
    target = "${aws_apigatewayv2_api.api.api_endpoint}/data/current.json"
    status = "200"
  }
  # files with these extensions are served as they are; any other path is the app (index.html).
  # mjs = MapLibre's worker, pbf = map label fonts, webmanifest = the installable app,
  # geojson = the Proof screen's reported streets
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|mjs|png|txt|svg|woff|woff2|ttf|map|json|geojson|webp|pmtiles|bin|pbf|webmanifest)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }

  # offline: the service worker and the page are never cached by the CDN or the browser, so a new
  # version reaches phones; hashed assets are immutable
  custom_headers = <<-EOT
    customHeaders:
      - pattern: '/sw.js'
        headers:
          - key: Cache-Control
            value: no-cache
      - pattern: '/index.html'
        headers:
          - key: Cache-Control
            value: no-cache
      - pattern: '/data/current.json'
        headers:
          - key: Cache-Control
            value: no-cache
      - pattern: '/manifest.webmanifest'
        headers:
          - key: Cache-Control
            value: no-cache
          - key: Content-Type
            value: application/manifest+json
      - pattern: '/assets/**'
        headers:
          - key: Cache-Control
            value: public, max-age=31536000, immutable
  EOT

  # Amplify stores the headers as JSON and hands them back that way, so every plan would show a change
  # that is none. To change the headers: edit them above, remove this block for one apply, put it back.
  lifecycle {
    ignore_changes = [custom_headers]
  }
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.site.id
  branch_name = "main"
  stage       = "PRODUCTION"
}

# ---------------------------------------------------------------- spending alarm
# Already in the account from the first deploy of the day: adopted, not recreated.
import {
  to = aws_budgets_budget.monthly
  id = "${data.aws_caller_identity.current.account_id}:${var.project}-30usd"
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-30usd"
  budget_type  = "COST"
  limit_amount = "30"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.alert_email == "" ? [] : [var.alert_email]
    content {
      notification_type          = "ACTUAL"
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [notification.value]
    }
  }
}
