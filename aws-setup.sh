#!/usr/bin/env bash -e

source ./config/variables

if [ -z "$(type aws)" ]; then
  echo
  echo "Installing AWS CLI tools ..."
  pip install awscli
  if -z "$(type aws)"; then
    echo "aws is not in path.. please check and re-run."
    exit 1
  else
    echo
    echo "Running 'aws configure' ..."
    aws configure
  fi
fi

rm -f .env
touch .env

# Create SNS Topic (and store ARN in .env)
echo "Creating $SNS_TOPIC_NAME SNS topic ..."
sns_response="$(
  aws sns create-topic \
    --name "$SNS_TOPIC_NAME"
)"
AWS_SNS_TOPIC_ARN=$(echo $sns_response | python -c "import sys, json; print(json.load(sys.stdin)['TopicArn'])")
echo "export AWS_SNS_TOPIC_ARN=$AWS_SNS_TOPIC_ARN" >> .env

# TODO: eliminate the extra email this will give, even if already subscribed
echo
echo "Subscribing to $SNS_TOPIC_NAME ..."
aws sns subscribe --topic-arn "$AWS_SNS_TOPIC_ARN" --protocol "$NOTIFICATION_PROTOCOL" --notification-endpoint "$NOTIFICATION_ENDPOINT"



# Create role (and store ARN in .env)
echo
echo "Creating $ROLE_NAME role ..."
role_response="$(
  aws iam get-role \
    --role-name "$ROLE_NAME" 2>/dev/null || \
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$PWD/config/aws-lambda-role-policy.json"
)"
ROLE_ARN=$( echo $role_response | python -c "import sys, json; print(json.load(sys.stdin)['Role']['Arn'])" )
echo "export ROLE_ARN=$ROLE_ARN" >> .env

# Attach policies to the role
echo
echo "Attaching role policy AmazonSNSFullAccess to $ROLE_NAME ..."
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/AmazonSNSFullAccess"

echo
echo "Attaching role policy CloudWatchLogsFullAccess to $ROLE_NAME ..."
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" 2>/dev/null \
  --policy-arn "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"

echo
echo "Building lambda bundle ..."
./build-lambda-bundle.sh

# Create lambda function (and store ARN in .env)
echo
echo "Creating $LAMBDA_FUNCTION_NAME lambda function ..."
lambda_response="$(
  aws lambda get-function \
    --function-name "$LAMBDA_FUNCTION_NAME" 2>/dev/null || \
  aws lambda create-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime "$LAMBDA_FUNCTION_RUNTIME" \
    --handler "$LAMBDA_FUNCTION_HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://lambda-build.zip"
)"
LAMBDA_FUNCTION_ARN=$( echo $lambda_response | python -c "import sys, json; x=json.load(sys.stdin); print(x.get('Configuration',x)['FunctionArn'])" )
echo "export LAMBDA_FUNCTION_ARN=$LAMBDA_FUNCTION_ARN" >> .env

# Create scheduling rule for lambda function (and store ARN in .env)
echo
echo "Creating scheduling rule for lambda function ..."
aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "$RULE_EXPRESSION" \
  --description "$RULE_EXPRESSION_DESCRIPTION"
rule_response="$(
  aws events describe-rule \
    --name "$RULE_NAME"
)"
RULE_ARN=$( echo "$rule_response" | python -c "import sys, json; print(json.load(sys.stdin)['Arn'])" )
echo "export RULE_ARN=$RULE_ARN" >> .env

echo
echo "Adding scheduling rule to lambda function $LAMBDA_FUNCTION_NAME ..."
aws lambda add-permission \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id 1 \
  --action lambda:invokeFunction \
  --principal events.amazonaws.com \
  --source-arn "$RULE_ARN"
aws events put-targets \
  --rule "$RULE_NAME" \
  --targets '{
    "Id": "1",
    "Arn": "'"$LAMBDA_FUNCTION_ARN"'",
    "Input": "'"$( echo "$RULE_INPUT" | python -c 'import sys, json; print(json.dumps(json.load(sys.stdin)))' | perl -p -e 's/\\/\\\\/g' | perl -p -e 's/"/\\"/g' )"'"
}'

echo
echo 'Done!'
