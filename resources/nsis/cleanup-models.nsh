!macro customInit
  Push $0
  Push $1
  Push $2

  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq EchoDraft.exe" /FO CSV /NH'
  Pop $0
  Pop $1

  StrCmp $0 "0" 0 done
  StrCmp $1 "INFO: No tasks are running which match the specified criteria." done

  MessageBox MB_ICONQUESTION|MB_YESNO \
    "EchoDraft is currently running. The installer needs to close it before continuing.$\r$\n$\r$\nClose EchoDraft now?" \
    IDYES close_app
  MessageBox MB_ICONSTOP \
    "Setup cannot continue while EchoDraft is running. Please close EchoDraft and run the installer again."
  Abort

close_app:
  nsExec::ExecToLog 'taskkill /IM EchoDraft.exe'
  Sleep 1500

  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq EchoDraft.exe" /FO CSV /NH'
  Pop $0
  Pop $1

  StrCmp $0 "0" 0 done
  StrCmp $1 "INFO: No tasks are running which match the specified criteria." done

  MessageBox MB_ICONEXCLAMATION|MB_YESNO \
    "EchoDraft did not close in time. Force close it and continue?" \
    IDYES force_close
  MessageBox MB_ICONSTOP \
    "Setup cannot continue while EchoDraft is running. Please close EchoDraft and run the installer again."
  Abort

force_close:
  nsExec::ExecToLog 'taskkill /F /IM EchoDraft.exe'
  Sleep 1000

  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq EchoDraft.exe" /FO CSV /NH'
  Pop $0
  Pop $1

  StrCmp $0 "0" 0 done
  StrCmp $1 "INFO: No tasks are running which match the specified criteria." done

  MessageBox MB_ICONSTOP \
    "Setup could not close EchoDraft automatically. Please close it manually and run the installer again."
  Abort

done:
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  StrCpy $0 "$PROFILE\.cache\echodraft\models"
  IfFileExists "$0\*.*" 0 +3
    RMDir /r "$0"
    DetailPrint "Removed EchoDraft cached models"
  StrCpy $1 "$PROFILE\.cache\echodraft"
  RMDir "$1"
!macroend
