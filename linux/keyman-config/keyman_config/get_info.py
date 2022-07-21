#!/usr/bin/python3

import logging
import os
import threading

from keyman_config import secure_lookup
from keyman_config.install_kmp import process_keyboard_data
from keyman_config.kmpmetadata import parsemetadata


class GetInfo(object):
    """ Get information about kmp packages and keyboards
    The run() method will be started and it will run in the background.
    """

    def __init__(self, kmp_list):
        """ Constructor
        :type kmp_list: list
        :param kmp_list: List of keyboards to get info for
        """
        self.kmp_list = kmp_list

        thread = threading.Thread(target=self.run, args=())
        thread.daemon = True                            # Daemonize thread
        thread.start()                                  # Start the execution

    def run(self):
        """ Method that gets info for installed kmp that were installed manually
        rather then from the download window.
        """
        for kmp in self.kmp_list:
            packageId = secure_lookup(kmp, 'packageID')
            areapath = secure_lookup(kmp, 'areapath')
            if not areapath or not packageId:
                logging.warning('corrupt kmp list')
                return
            packageDir = os.path.join(areapath, packageId)
            process_keyboard_data(packageId, packageDir)
            info, system, options, keyboards, files = parsemetadata(packageDir, "kmp.json")
            if keyboards:
                for kb in keyboards:
                    if kb['id'] != packageId:
                        process_keyboard_data(kb['id'], packageDir)
