# AWS Lambda container image for the photo service (x86_64). Build from the repository root:
#   docker buildx build --platform linux/amd64 -f services/vision/Dockerfile .
FROM public.ecr.aws/lambda/python:3.12
COPY services/vision/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/vision/app ${LAMBDA_TASK_ROOT}/app
CMD ["app.handler.handler"]
