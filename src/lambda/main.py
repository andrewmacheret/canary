#!/usr/bin/env python2.7

from urllib import quote
import json
import os
from requests import get
import pprint
import boto3

pp = pprint.PrettyPrinter(indent=4)

def lambda_handler(event, context):
    aws_sns_topic_arn = event['sns']
    urls_to_test = event['urls']

    failures = []
    for url in urls_to_test:
        try:
            response = get(url, timeout=1)
            if response.status_code != 200:
                failures.append({
                    'url': url,
                    'error': 'Status code: ' + response.status_code,
                })
                print(url, 'FAIL')
            else:
                print(url, 'PASS')
        except Exception as err:
            print(url, 'EXCEPTION')
            pp.pprint(repr(err))
            failures.append({
                'url': url,
                'error': repr(err),
            })
        except:
            print(url, 'UNKNOWN_ERROR')
            failures.append({
                'url': url,
                'error': 'Unknown error!',
            })

    pp.pprint(failures)

    if len(failures) > 0:
        publish_command_to_sns(failures)


# --------------- Helpers that build all of the responses ----------------


def publish_command_to_sns(message):
    client = boto3.client('sns')

    response = client.publish(
        TargetArn=AWS_SNS_TOPIC_ARN,
        #Message=json.dumps({'default': json.dumps(message)}),
        #Message=json.dumps(message),
        Message=message,
        MessageStructure='text'
    )

    print(response['ResponseMetadata'])

    if response['ResponseMetadata']['HTTPStatusCode'] != 200:
        message = 'SNS Publish returned {} response instead of 200.'.format(
            response['ResponseMetadata']['HTTPStatusCode'])
        raise SNSPublishError(message)


class SNSPublishError(Exception):
    """ If something goes wrong with publishing to SNS """
    pass

#lambda_handler(None, None)
