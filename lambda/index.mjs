// Lambda CanaryDispatch. EventBridge Scheduler runs it once a day.
// It throws when GitHub says no, so the CloudWatch alarm emails Andrew.
// The SDK comes with the Lambda runtime.
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { dispatch } from './dispatch.mjs';

const ssm = new SSMClient({});

export async function handler() {
  const { Parameter } = await ssm.send(new GetParameterCommand({
    Name: process.env.TOKEN_PARAMETER,
    WithDecryption: true
  }));
  // Pasting the token into the terminal leaves a newline at the end
  await dispatch(Parameter.Value.trim());
  console.log('started daily.yml');
  return { started: 'daily.yml' };
}
