#!/usr/bin/env python2.7

from urllib import quote
import json
import os
from requests import get
import pprint
import boto3

pp = pprint.PrettyPrinter(indent=4)

AWS_SNS_TOPIC_ARN = os.getenv('AWS_SNS_TOPIC_ARN')

URLS_TO_TEST = [
  'https://pun.andrewmacheret.com',
  'https://chess.andrewmacheret.com',
  'https://ascii-cow.andrewmacheret.com',
  'https://nhl.andrewmacheret.com',
  'https://remote-apis.andrewmacheret.com',
  'https://montyhall.andrewmacheret.com',
]

def lambda_handler(event, context):
    failures = []
    for url in URLS_TO_TEST:
        try:
            response = get(url)
            if response.status_code != 200:
                failures.append({
                    'url': url,
                    'error': 'Status code: ' + response.status_code,
                })
        except Exception as err:
            pp.pprint(repr(err))
            failures.append({
                'url': url,
                'error': repr(err),
            })
        except:
            failures.append({
                'url': url,
                'error': 'Unknown error!',
            })

    pp.pprint(failures)

    if len(failures) > 0:
        publish_command_to_sns(failures)


# --------------- Helpers that build all of the responses ----------------


def publish_command_to_sns(failures):
    messages = []
    for failure in failures:
        pp.pprint(failure)
        messages.append('%s - %s' % (failure['url'], failure['error']))

    message = '\n'.join(messages)

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
