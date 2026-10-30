/** Google Apps Script used to forward labelled Gmail CSVs into the email webhook. */
export function emailImportAppsScript(origin: string): string {
  const base = origin.replace(/\/$/, '') || 'https://your-app.vercel.app';
  return `// === CONFIGURATION ===
var WEBHOOK_URL = '${base}/api/webhooks/email';
var API_KEY = 'YOUR_API_KEY_HERE'; // From Integrations page
var LABEL_TO_PROCESS = 'to-import';
var LABEL_DONE = 'imported';

function processEmails() {
  var toProcess = GmailApp.getUserLabelByName(LABEL_TO_PROCESS);
  var done = GmailApp.getUserLabelByName(LABEL_DONE);
  if (!toProcess) { toProcess = GmailApp.createLabel(LABEL_TO_PROCESS); }
  if (!done) { done = GmailApp.createLabel(LABEL_DONE); }

  var threads = toProcess.getThreads(0, 10);
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      var attachments = msg.getAttachments();
      var csvAttachments = [];

      for (var k = 0; k < attachments.length; k++) {
        var att = attachments[k];
        if (att.getName().toLowerCase().endsWith('.csv')) {
          csvAttachments.push({
            name: att.getName(),
            content: Utilities.base64Encode(att.getBytes())
          });
        }
      }

      if (csvAttachments.length > 0) {
        var payload = {
          sender: msg.getFrom(),
          subject: msg.getSubject(),
          attachments: csvAttachments
        };

        var options = {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-api-key': API_KEY },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };

        var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
        Logger.log('Import result: ' + response.getContentText());
      }
    }
    threads[i].removeLabel(toProcess);
    threads[i].addLabel(done);
  }
}`;
}
