# Discussione Cursor - 2026-06-02

Questo file salva in repository i punti principali emersi nella sessione.

Trascrizione completa della chat (archivio Cursor):
- [Setup repo e autosave](805d54c2-97d0-43db-bcdb-73b7b03d5d60)

## Decisioni principali

- Repository unico online confermato su GitHub: `officinaspl/acquedotto-attuale`
- Flusso semplice confermato: `pull` prima di lavorare, `push` dopo
- Script `commit_push.bat` creato e testato con esito OK
- Autosave automatico configurato su Windows con task `AcquedottoAutoGit`
- Intervallo autosave impostato a 60 secondi
- Gestione cartelle vuote aggiunta: creazione automatica `.gitkeep`

## Stato progetto firmware

- Sketch principale Heltec in `heltec_esp32_lora_acquedotto`
- Archivio revisione presente: `heltec_esp32_lora_acquedotto_rev007`
- Regola revisioni aggiornata: mantenere snapshot recenti e rotazione

## Note operative

- Su Mac: usare stesso repository GitHub via `git clone`
- Cursor puo usare terminale integrato per `pull/push`
- Chat tra dispositivi non e sempre garantita identica; il codice su GitHub si
  sincronizza in modo affidabile

