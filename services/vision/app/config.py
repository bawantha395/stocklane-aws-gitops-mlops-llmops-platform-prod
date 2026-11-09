import os


class Settings:
    """Read from the Lambda environment (set by Terraform)."""

    def __init__(self, env=None):
        e = env if env is not None else os.environ
        self.table = e.get('TABLE', '')
        self.media_bucket = e.get('MEDIA_BUCKET', '')
        self.model_bucket = e.get('MODEL_BUCKET', '')
        self.model_dir = e.get('MODEL_DIR', '/tmp/model')
        self.aws_region = e.get('AWS_REGION', 'ap-southeast-2')
        self.bedrock_model_id = e.get('BEDROCK_MODEL_ID', '')
        self.bedrock_region = e.get('BEDROCK_REGION', '')
        self.bedrock_daily_request_limit = int(e.get('BEDROCK_DAILY_LIMIT', '50'))
        self.textract_fallback = e.get('TEXTRACT_FALLBACK', 'false') == 'true'
        self.textract_region = e.get('TEXTRACT_REGION', '')
        self.match_threshold = float(e.get('MATCH_THRESHOLD', '0.92'))
        self.max_upload_bytes = int(e.get('MAX_UPLOAD_BYTES', str(4 * 1024 * 1024)))  # Lambda's request limit is 6 MB
