#!/usr/bin/env bash -e

source ./config/variables

if [ -f .env ]; then
  source .env
fi

PYTHON_PARSE_ROLE_POLICIES="
import sys, json
for a in json.load(sys.stdin)['AttachedPolicies']:
  print(a['PolicyArn'])
"

if [ ! -z "$ROLE_NAME" ]; then
  echo "Detaching role policies"
  aws iam list-attached-role-policies --role-name "$ROLE_NAME" |
    python -c "$PYTHON_PARSE_ROLE_POLICIES" |
    xargs -n1 aws iam detach-role-policy \
      --role-name "$ROLE_NAME" \
      --policy-arn

  echo "Deleting role $ROLE_NAME"
  aws iam delete-role --role-name "$ROLE_NAME" || true
fi

if [ ! -z "$LAMBDA_FUNCTION_NAME" ]; then
  echo "Deleting lambda function $LAMBDA_FUNCTION_NAME"
  aws lambda delete-function --function-name "$LAMBDA_FUNCTION_NAME" || true
fi

if [ ! -z "$RULE_NAME" ]; then
  echo "Deleting rule $RULE_NAME"
  aws events delete-rule --name "$RULE_NAME"
fi

if [ ! -z "$AWS_SNS_TOPIC_ARN" ]; then
  echo "Deleting SNS topic $AWS_SNS_TOPIC_ARN"
  aws sns delete-topic --topic-arn "$AWS_SNS_TOPIC_ARN" || true
fi

rm -f .env
