import * as vscode from 'vscode';
import axios from 'axios';
import { SettingsProvider, SettingItem } from './SettingsProvider';

let settingsProvider: SettingsProvider;

const apiKey = vscode.workspace.getConfiguration().get('code-docs-ai.apiKey') as string;

let FEW_SHOTS = `For the following prompt take into account these 3 input/output terms, of how a comment should be written:
Function:
def elapsed_tid(cls, reference, new):
        time_difference = new.toTimestamp() - reference.toTimestamp()
        return np.int64(time_difference * 1.0e6 // cls._period)
Comment:
"""
        Calculate the elapsed trainId between reference and newest timestamp

        :param reference: the reference timestamp
        :param new: the new timestamp

        :type reference: Timestamp
        :type new: Timestamp

        :returns: elapsed trainId's between reference and new timestamp
"""
Function:
def get_array_data(data, path=None, squeeze=True):
    text = "Expected a Hash, but got type %s instead!" % type(data)
    assert isinstance(data, Hash), text
    array = _build_ndarray(data, path=path, squeeze=squeeze)
    return array
Comment:
"""
    Method to extract an 'ndarray' from a raw Hash

    :param data: A hash containing the data hash
    :param path: The path of the NDArray. If 'None' (default) the input Hash is taken.
    :param squeeze: If the array should be squeezed if the latest dimension is 1. Default is 'True'.

    :returns: A numpy array containing the extracted data
"""
Function:
async def getSchema(device, onlyCurrentState=False):
    if isinstance(device, ProxyBase):
        if not onlyCurrentState:
            return Schema(name=device.classId, hash=device._schema_hash)
        else:
            device = device._deviceId

    schema, _ = await get_instance().call(device, "slotGetSchema",
                                          onlyCurrentState)
    return schema
Comment:
"""
    Get a schema from a target device

    :param device: deviceId or proxy
    :param onlyCurrentState: Boolean for the state dependent schema. The default is 'False'.

    :returns: Full Schema object
"""`;

let DEFAULT_PROMPT = `Generate a comment for the following function:{FUNCTION_CONTENT}. 
Adhere to the python comment syntax for multiline comments.
Fill out this given template and just return the comment, not the programming language: 
Brief description of the function.

:param name: Description
:type name: type

:returns: Description
:return type: type`;
const originalEditor = vscode.window.activeTextEditor;

export function activate(context: vscode.ExtensionContext) {
    settingsProvider = new SettingsProvider();
    vscode.window.registerTreeDataProvider('codeDocsAISettings', settingsProvider);

    context.subscriptions.push(vscode.commands.registerCommand('extension.editSetting', async (item: SettingItem) => {
        const config = vscode.workspace.getConfiguration('code-docs-ai');
        if (item.label === 'API Key') {
            const newApiKey = await vscode.window.showInputBox({ prompt: 'Enter your API Key', value: item.value === 'Enter your API key' ? '' : item.value });
            if (newApiKey !== undefined) {
                settingsProvider.updateSettings(newApiKey, undefined);
            }
        } else if (item.label === 'GPT Model') {
            const newModel = await vscode.window.showQuickPick(["gpt-4",
                    "gpt-4-turbo",
                    "gpt-4o-mini",
                    "gpt-4o"], { placeHolder: 'Select a GPT model', canPickMany: false });
            if (newModel) {
                settingsProvider.updateSettings(undefined, newModel);
            }
        }
    }));

    let generateCommentCmd = vscode.commands.registerCommand('extension.generateComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selectedText = editor.document.getText(editor.selection);
            const functionStartLine = editor.selection.start.line;
            try {
                const comment = await generateComment(selectedText);
                const indentedComment = comment
                    .split('\n')
                    .map(line => '    ' + line) //not sure if this solution to the tabs vs spaces problem is entirely foolproof.
                    .join('\n');
                const newPosition = new vscode.Position(functionStartLine + 1, 0);
                editor.edit(builder => {
                    builder.insert(newPosition, `${indentedComment}\n`);
                });
            } catch (error) {
                vscode.window.showErrorMessage('Failed to generate a comment. Please enter a valid OpenAI API key in the settings of the Code Docs AI extension. If this does not fix the problem, it is caused by OpenAI; please try again later.');
            }
        }
    });

    let openPromptEditorCmd = vscode.commands.registerCommand('extension.openPromptEditor', () => {
        const panel = vscode.window.createWebviewPanel(
            'editPrompt',
            'Edit Default Prompt',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true //This option allows scripts to run in the webview
            }
        );

        panel.webview.html = getWebviewContent(DEFAULT_PROMPT);

        panel.webview.onDidReceiveMessage(
            async message => {
                if (message.action === 'saveAndGenerate') {
                    DEFAULT_PROMPT = message.prompt;
                    vscode.window.showInformationMessage('Default prompt updated.');

                    if (originalEditor) {
                        const selectedText = originalEditor.document.getText(originalEditor.selection);
                        const functionStartLine = originalEditor.selection.start.line;
                        if (selectedText) {
                            try {
                                const comment = await generateComment(selectedText, DEFAULT_PROMPT);
                                const indentedComment = comment
                                    .split('\n')
                                    .map(line => '    ' + line) //not sure if this solution to the tabs vs spaces problem is entirely foolproof.
                                    .join('\n');
                                const newPosition = new vscode.Position(functionStartLine + 1, 0);
                                originalEditor.edit(builder => {
                                    builder.insert(newPosition, `${indentedComment}\n`);
                                });
                            } catch (error) {
                                vscode.window.showErrorMessage('Failed to generate a comment. Please enter a valid OpenAI API key in the settings of the Code Docs AI extension. If this does not fix the problem, it is caused by OpenAI; please try again later.');
                            }
                        }
                    }
                }
            },
            null,
            context.subscriptions
        );
    });

    context.subscriptions.push(generateCommentCmd, openPromptEditorCmd);
}

async function generateComment(selectedText: string, prompt?: string): Promise<string> {
    try {
        const client = axios.create({
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });

        const config = vscode.workspace.getConfiguration('code-docs-ai');
        const gptModel = config.get<string>('gptModel') || 'gpt-4';
        const params = {
            model: gptModel,
            messages: [
                {
                    role: 'system',
                    content: 'You are a programmer.' //Future work could maybe adjust the persona of the system here.
                },
                {
                    role: 'user',
                    content: FEW_SHOTS + (prompt || DEFAULT_PROMPT).replace('{FUNCTION_CONTENT}', selectedText),
                },
            ],
        };

        const response = await client.post(
            'https://api.openai.com/v1/chat/completions',
            params
        );

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenAI API request error:', error);
        throw error;
    }
}

function getWebviewContent(defaultPrompt: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Edit Default Prompt</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
                    padding: 16px;
                    background-color: #f4f4f4;
                }

                textarea {
                    width: 100%;
                    min-height: 200px;
                    padding: 8px;
                    border-radius: 4px;
                    border: 1px solid #ccc;
                    font-size: 1rem;
                    font-family: inherit;
                    resize: vertical;
                }

                button {
                    margin-top: 16px;
                    padding: 8px 16px;
                    background-color: #007acc;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 1rem;
                    transition: background-color 0.2s;
                }

                button:hover {
                    background-color: #005a9e;
                }
            </style>
        </head>
        <body>
            <textarea id="prompt" rows="10" cols="50">${defaultPrompt}</textarea>
            <button onclick="savePrompt()">Generate Comment</button>
            <script>
                const vscode = acquireVsCodeApi();

                function savePrompt() {
                    let prompt = document.getElementById('prompt').value;
                    console.log("test");
                    vscode.postMessage({ 
                        action: 'saveAndGenerate',
                        prompt: prompt 
                    });
                }
            </script>
        </body>
        </html>
    `;
}