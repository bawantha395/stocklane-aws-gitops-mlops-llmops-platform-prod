"""Runs the real handler against an in-memory DynamoDB (moto). No AWS account needed."""
import os
import sys

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ.update(AWS_DEFAULT_REGION='ap-southeast-2', AWS_ACCESS_KEY_ID='x', AWS_SECRET_ACCESS_KEY='x', TABLE='test-table', MEDIA_BUCKET='test-media')


@pytest.fixture
def api():
    from stocklane_api import core, handler
    with mock_aws():
        core._resource = None
        boto3.client('dynamodb').create_table(
            TableName='test-table', BillingMode='PAY_PER_REQUEST',
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}, {'AttributeName': 'sk', 'AttributeType': 'S'}],
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}])
        counter = iter(range(10 ** 6))

        def call(method, path, body=None, role='OWNER', who='owner@example.com', query=None):
            import json
            event = {'requestContext': {'http': {'method': method}, 'authorizer': {'jwt': {'claims': {'cognito:groups': role, 'username': who}}}},
                     'rawPath': path, 'headers': {'idempotency-key': 'key-%016d' % next(counter)}, 'queryStringParameters': query or {},
                     'body': json.dumps(body) if body is not None else ''}
            r = handler.handler(event)
            return r['statusCode'], json.loads(r['body'])
        yield call
        core._resource = None
