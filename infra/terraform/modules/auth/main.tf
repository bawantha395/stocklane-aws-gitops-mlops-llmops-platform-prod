# Cognito user pool for staff sign-in (MFA required, admin-created users only)

resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  admin_create_user_config {
    allow_admin_create_user_only = true
    # the e-mail a new owner or staff member gets (Cognito fills in {username} and {####})
    invite_message_template {
      email_subject = "Welcome to Lifta - your sign-in"
      email_message = "Hello,<br><br>You have been added to a workshop on <b>Lifta</b>.<br><br>Open: ${length(var.app_urls) > 0 ? var.app_urls[0] : ""}<br>E-mail: {username}<br>Temporary password: {####}<br><br>You will choose your own password and set up the authenticator app the first time you sign in. The temporary password stops working after 7 days.<br><br>Lifta"
      sms_message   = "Lifta sign-in {username} temporary password {####}"
    }
  }
  password_policy {
    minimum_length    = 14
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"
  mfa_configuration   = "ON"
  software_token_mfa_configuration { enabled = true }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.name}-${var.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_group" "staff" {
  for_each     = toset(["OWNER", "ADMIN", "STOREKEEPER", "MECHANIC", "PLATFORM"]) # PLATFORM = runs this deployment: opens and closes workshops
  user_pool_id = aws_cognito_user_pool.main.id
  name         = each.key
}

# The first owner. Cognito emails a temporary password; MFA is set up at first sign-in.
resource "aws_cognito_user" "owner" {
  count                    = var.owner_email == "" ? 0 : 1
  user_pool_id             = aws_cognito_user_pool.main.id
  username                 = var.owner_email
  desired_delivery_mediums = ["EMAIL"]
  attributes = {
    email          = var.owner_email
    email_verified = "true"
  }
}

resource "aws_cognito_user_in_group" "owner" {
  count        = var.owner_email == "" ? 0 : 1
  user_pool_id = aws_cognito_user_pool.main.id
  group_name   = aws_cognito_user_group.staff["OWNER"].name
  username     = aws_cognito_user.owner[0].username
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "react-pwa"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [for url in var.app_urls : "${url}/auth/callback"]
  logout_urls                          = var.app_urls
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

